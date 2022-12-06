import { spawn } from 'child_process';

export function spawnAsync(command: string, args: string[], options?: any) {
	return new Promise<{ code: number | null; hasStdErr: boolean | null, stdOut: string, stdErr: string }>((resolve) => {
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
			const stdoutBuffer = Buffer.concat(stdout).toString();
			const stderrBuffer = Buffer.concat(stderr).toString();
			resolve({ code, hasStdErr: stderr.length > 0, stdOut: stdoutBuffer, stdErr: stderrBuffer });
		});
	});
}