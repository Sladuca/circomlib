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

function generate_witness() {
	console.log('generating witness...')
	fs.writeFileSync(`${__dirname}/output/input.json`, JSON.stringify(input));
	return new Promise((res, rej) => {
		const startTime = performance.now();
		exec(`node ${__dirname}/output/sha256_2_x15_js/generate_witness.js ${__dirname}/output/sha256_2_x15_js/sha256_2_x15.wasm ${__dirname}/output/input.json ${__dirname}/output/witness.wtns`, (err, stdout, stderr) => {
			const endTime = performance.now();
			console.log(`witness generation took ${endTime - startTime} milliseconds`);
			if (err) {
				rej(err);
			} else {
				console.log("witness generation stdout:\n", stdout);
				if (stderr) {
					console.log("witness generation stderr:\n", stderr);
				}
				sleep(1000);
				res();
			}
		})
	})
}

function setup() {
	console.log("performing trusted setup...")
	
	return new Promise((res, rej) => {
		// don't time the first two parts because they're not circuit-specific
		exec(`snarkjs powersoftau new bn128 19 ${__dirname}/output/pot19_0000.ptau -v`, (err, stdout, stderr) => {	
			if (err) {
				rej(err);
			} else {
				res();
			}
		})
	}).then((res) => {
		return new Promise((res, rej) => {
			exec(`snarkjs powersoftau contribute ${__dirname}/output/pot19_0000.ptau ${__dirname}/output/pot19_0001.ptau --name=\"First contribution\" -v -e=\"${setupFakeEntropy0}\"`, (err, stdout, stderr) => {
				if (err) {
					console.error(stderr);
					rej(err);
				} else {
					res();
				}
			})
		})
	}).then((res) => {
		const startTime = performance.now();
		return new Promise((res, rej) => {
			exec(`snarkjs powersoftau prepare phase2 ${__dirname}/output/pot19_0001.ptau ${__dirname}/output/pot19_final.ptau -v`, (err, stdout, stderr) => {
				if (err) {
					rej(err);
				} else {
					res(startTime);
				}
			})
		})
	}).then((res) => {
		const startTime = res;
		return new Promise((res, rej) => {
			exec(`snarkjs groth16 setup ${__dirname}/output/sha256_2_x15.r1cs ${__dirname}/output/pot19_final.ptau ${__dirname}/output/sha256_2_x15_0000.zkey`, (err, stdout, stderr) => {
				if (err) {
					rej(err);
				} else {
					res(startTime);
				}
			})
		})
	}).then((res) => {
		const startTime = res;
		return new Promise((res, rej) => {
			exec(`snarkjs zkey contribute ${__dirname}/output/sha256_2_x15_0000.zkey ${__dirname}/output/sha256_2_x15_0001.zkey --name=\"sha2_benchmark_${setupContributionName}\" -v -e=\"${setupFakeEntropy1}\"`, (err, stdout, stderr) => {
				if (err) {
					rej(err);
				} else {
					res(startTime);
				}
			})
		})
	}).then((res) => {
		const startTime = res;
		return new Promise((res, rej) => {
			console.log(5);
			exec(`snarkjs zkey export verificationkey ${__dirname}/output/sha256_2_x15_0001.zkey ${__dirname}/output/verification_key.json`, (err, stdout, stderr) => {
				const stopTime = performance.now();
				console.log(`setup took ${stopTime - startTime} milliseconds`);
				if (err) {
					rej(err);
				} else {
					res();
				}
			})
		})
	})
}

function prove() {
	return new Promise((res, rej) => {
		console.log("proving circuit...")
		const startTime = performance.now();
		exec(`snarkjs groth16 prove ${__dirname}/output/sha256_2_x15_0001.zkey ${__dirname}/output/witness.wtns ${__dirname}/output/proof.json ${__dirname}/output/public.json`, (err, stdout, stderr) => {
			const stopTime = performance.now();
			console.log(`proving took ${stopTime - startTime} milliseconds.`);
			if (err) {
				console.log(`prover stderr: \n${stderr}`);
				rej(err);
			} else {
				console.log(`prover stdout: \n${stdout}`);
				res(stopTime - startTime);
			}
		})
	})
}


async function main() {
	console.log("input:", input);

	if (!fs.existsSync(`${__dirname}/output`)) {
		fs.mkdirSync(`${__dirname}/output`);
	}

	// only compile if it hasn't been done yet
	if (!fs.existsSync(`${__dirname}/output/sha256_2_x15.r1cs`)) {
		await compile();
	} else {
		console.log("circuit already compiled - skipping...");
	}

	await generate_witness();

	// only do the trusted setup if it hasn't been done yet
	if (!fs.existsSync(`${__dirname}/output/verification_key.json`)) {
		await setup();
	} else {
		console.log("trusted setup already done - skipping...");
	}

	const times = [];
	let i = 0;
	for (i; i < 10; i++) {
		times.push(await prove());
	}

	const sum = times.reduce((a, b) => a + b, 0);
	const avg = sum / times.length;
	console.log(`average proving time: ${avg} milliseconds`);
}

main();