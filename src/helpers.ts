import { spawn } from 'child_process';

export function spawnAsync(command: string, args: string[], options?: any) {
	return new Promise<{ code: number | null; hasStdErr: boolean | null }>((resolve) => {
        console.log(`args: ${args.join(' ')}`);
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const proc = spawn(command, args, { shell: true, ...options });
		proc.stdout.on('data', (data) => {
			stdout.push(data);
		});

		proc.stderr.on('data', (data) => {
			stderr.push(data);
		});

		proc.on('close', (code) => {
			console.log(`child process exited with code ${code}`);
			const stdoutBuffer = Buffer.concat(stdout);
			const stderrBuffer = Buffer.concat(stderr);
			console.log(`stdout: ${stdoutBuffer.toString()}`);
			console.error(`stderr: ${stderrBuffer.toString()}`);
			resolve({ code, hasStdErr: stderr.length > 0 });
		});
	});
}