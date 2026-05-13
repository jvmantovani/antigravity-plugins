import { exec } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import { Logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface ServerInfo {
	pid: number;
	port: number;
	csrfToken: string;
}

/**
 * Discovers the Antigravity language server process and extracts
 * the connection credentials (port + CSRF token) from its command line.
 * This is the same strategy used by AntigravityQuota (Henrik-3).
 */
export class ServerConnector {
	private cachedInfo: ServerInfo | null = null;

	constructor(private logger: Logger) {}

	async discover(): Promise<ServerInfo | null> {
		if (this.cachedInfo) {
			return this.cachedInfo;
		}

		try {
			const info = await this.findLanguageServer();
			if (info) {
				this.cachedInfo = info;
				this.logger.info(`Language server found: PID=${info.pid}, port=${info.port}`);
			}
			return info;
		} catch (err) {
			this.logger.error('Failed to discover language server', err);
			return null;
		}
	}

	invalidateCache(): void {
		this.cachedInfo = null;
	}

	private async findLanguageServer(): Promise<ServerInfo | null> {
		if (process.platform === 'win32') {
			return this.findOnWindows();
		} else if (process.platform === 'darwin') {
			return this.findOnUnix('pgrep -fl language_server_macos');
		} else {
			return this.findOnUnix('pgrep -af language_server_linux');
		}
	}

	private async findOnWindows(): Promise<ServerInfo | null> {
		const { stdout } = await execAsync(
			`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'name=''language_server_windows_x64.exe''' | Select-Object ProcessId,CommandLine | ConvertTo-Json"`
		);

		let processes: any[] = [];
		try {
			const parsed = JSON.parse(stdout.trim());
			processes = Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			this.logger.warn('Could not parse language server process list');
			return null;
		}

		// Prefer process with --app_data_dir antigravity
		const agProcess = processes.find(
			(p: any) => p.CommandLine && (
				/--app_data_dir\s+antigravity/i.test(p.CommandLine) ||
				/\\antigravity\\/i.test(p.CommandLine)
			)
		) || processes[0];

		if (!agProcess?.CommandLine) {return null;}
		return this.parseCommandLine(agProcess.ProcessId, agProcess.CommandLine);
	}

	private async findOnUnix(pgrepCmd: string): Promise<ServerInfo | null> {
		const { stdout } = await execAsync(pgrepCmd);
		const lines = stdout.split('\n').filter(l => l.includes('--csrf_token'));
		if (!lines.length) {return null;}

		const line = lines[0].trim();
		const parts = line.split(/\s+/);
		const pid = parseInt(parts[0], 10);
		return this.parseCommandLine(pid, line);
	}

	private parseCommandLine(pid: number, cmdLine: string): ServerInfo | null {
		const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
		const portMatch  = cmdLine.match(/--extension_server_port[=\s]+(\d+)/);

		if (!tokenMatch || !portMatch) {
			this.logger.warn('Could not extract CSRF token or port from language server command line');
			return null;
		}

		return {
			pid,
			port: parseInt(portMatch[1], 10),
			csrfToken: tokenMatch[1],
		};
	}

	/**
	 * Makes an HTTP POST request to the language server.
	 * Note: some Antigravity versions use plain HTTP, others HTTPS.
	 */
	request<T>(info: ServerInfo, path: string, body: object): Promise<T> {
		return new Promise((resolve, reject) => {
			const data = JSON.stringify(body);
			const options: http.RequestOptions = {
				hostname: '127.0.0.1',
				port: info.port,
				path,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(data),
					'Connect-Protocol-Version': '1',
					'X-Codeium-Csrf-Token': info.csrfToken,
				},
				timeout: 5000,
			};

			const req = http.request(options, (res) => {
				let body = '';
				res.on('data', (chunk) => (body += chunk));
				res.on('end', () => {
					try {
						resolve(JSON.parse(body) as T);
					} catch {
						reject(new Error(`Invalid JSON (status ${res.statusCode}): ${body.substring(0, 100)}`));
					}
				});
			});

			req.on('error', reject);
			req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
			req.write(data);
			req.end();
		});
	}
}
