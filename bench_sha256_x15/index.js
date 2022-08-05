const fs = require("fs")
const { spawn } = require('child_process')
const { Scalar } = require("ffjavascript")
const { v4: uuidv4 } = require('uuid')
const { performance } = require('perf_hooks')

exports.p = Scalar.fromString("21888242871839275222246405745257275088548364400416034343698204186575808495617")

const input = {
	"a": Array.from(Array(15).keys()).map(i => i.toString()),
	"b": Array.from(Array(15).keys()).map(i => (i + 15).toString())
}

const [setupContributionName, setupFakeEntropy0, setupFakeEntropy1] = [uuidv4(), uuidv4(), uuidv4()]

const asyncExec = command => new Promise((resolve, reject) => {
	let stdout = '';
	let stderr = '';
	const child = spawn('sh', ['-c', command]);
	child.stdout.on('data', data => {
		const output = data.toString();
		console.log(output);
		stdout += output;
	});
	child.stderr.on('data', data => {
		const output = data.toString();
		console.error(output);
		stderr += output;
	});
	child.on('error', reject);
	child.on('exit', () => resolve([stdout, stderr]));
})

async function compile() {
	console.log('\x1b[32m Compiling circuit... \x1b[0m')
	const startTime = performance.now()
	await asyncExec(`circom ${__dirname}/../circuits/sha256/sha256_2_x15.circom --r1cs --wasm -o \"${__dirname}/.output\"`)
	const endTime = performance.now()
	console.log(`Compilation took ${endTime - startTime} milliseconds`)
}

async function generateWitness() {
	console.log('\x1b[32mGenerating witness... \x1b[0m')
	fs.writeFileSync(`${__dirname}/.output/input.json`, JSON.stringify(input))
	const startTime = performance.now()
	await asyncExec(`node ${__dirname}/.output/sha256_2_x15_js/generate_witness.js ${__dirname}/.output/sha256_2_x15_js/sha256_2_x15.wasm ${__dirname}/.output/input.json ${__dirname}/.output/witness.wtns`)
	const endTime = performance.now()
	console.log(`Witness generation took ${endTime - startTime} milliseconds`)
}

async function setup() {
	console.log("\x1b[32mPerforming trusted setup... \x1b[0m")
	await asyncExec(`snarkjs powersoftau new bn128 19 ${__dirname}/.output/pot19_0000.ptau -v`)
	await asyncExec(`snarkjs powersoftau contribute ${__dirname}/.output/pot19_0000.ptau ${__dirname}/.output/pot19_0001.ptau --name=\"First contribution\" -v -e=\"${setupFakeEntropy0}\"`)
	const startTime = performance.now()
	await asyncExec(`snarkjs powersoftau prepare phase2 ${__dirname}/.output/pot19_0001.ptau ${__dirname}/.output/pot19_final.ptau -v`)
	await asyncExec(`snarkjs groth16 setup ${__dirname}/.output/sha256_2_x15.r1cs ${__dirname}/.output/pot19_final.ptau ${__dirname}/.output/sha256_2_x15_0000.zkey`)
	await asyncExec(`snarkjs zkey contribute ${__dirname}/.output/sha256_2_x15_0000.zkey ${__dirname}/.output/sha256_2_x15_0001.zkey --name=\"sha2_benchmark_${setupContributionName}\" -v -e=\"${setupFakeEntropy1}\"`)
	await asyncExec(`snarkjs zkey export verificationkey ${__dirname}/.output/sha256_2_x15_0001.zkey ${__dirname}/.output/verification_key.json`)
	const stopTime = performance.now()
	console.log(`Setup took ${stopTime - startTime} milliseconds`)
}

async function prove(i = 0) {
	console.log(`\x1b[32mProving circuit... (${i}/10) \x1b[0m`)
	const startTime = performance.now()
	await asyncExec(`snarkjs groth16 prove ${__dirname}/.output/sha256_2_x15_0001.zkey ${__dirname}/.output/witness.wtns ${__dirname}/.output/proof.json ${__dirname}/.output/public.json`)
	const stopTime = performance.now()
	console.log(`Proving took ${stopTime - startTime} milliseconds.`)
	return stopTime - startTime
}

async function main() {
	console.log("Input: ", input)

	if (!fs.existsSync(`${__dirname}/.output`)) {
		fs.mkdirSync(`${__dirname}/.output`)
	}

	// only compile if it hasn't been done yet
	if (!fs.existsSync(`${__dirname}/.output/sha256_2_x15.r1cs`)) {
		await compile();
	} else {
		console.log("Cached compiled circuit found - skipping...")
	}

	await generateWitness();

	// only do the trusted setup if it hasn't been done yet
	if (!fs.existsSync(`${__dirname}/.output/verification_key.json`)) {
		await setup()
	} else {
		console.log("Cached trusted setup found - skipping...")
	}

	const times = []
	for (let i = 0; i < 10;) {
		times.push(await prove(++i))
	}

	const sum = times.reduce((a, b) => a + b, 0)
	const avg = sum / times.length
	console.log(`Average proving time: ${avg} milliseconds`)
}

main();