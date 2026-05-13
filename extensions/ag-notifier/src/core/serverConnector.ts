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
 * Discovers the Antigravity language server's HTTP API port and CSRF token.
 *
 * Strategy (same as AntigravityQuota):
 * 1. Find language_server process and extract --csrf_token from its CLI args
 * 2. Get all TCP ports the process is listening on
 * 3. Test each port with a known endpoint until one responds correctly
 * 4. Cache the result (invalidated on error so we rediscover after restarts)
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
				this.logger.info(`Language server connected: PID=${info.pid}, port=${info.port}`);
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

	// ─── Discovery ────────────────────────────────────────────────────────────

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

		// Prefer the process belonging to Antigravity (not other Codeium forks)
		const agProcess = processes.find(
			(p: any) => p.CommandLine && (
				/--app_data_dir\s+antigravity/i.test(p.CommandLine) ||
				/\\antigravity\\/i.test(p.CommandLine)
			)
		) ?? processes[0];

		if (!agProcess?.CommandLine) { return null; }

		const credentials = this.extractCredentials(agProcess.ProcessId, agProcess.CommandLine);
		if (!credentials) { return null; }

		// Find the actual API port by testing all listening ports for this PID
		const listeningPorts = await this.getListeningPortsWindows(credentials.pid);
		this.logger.info(`PID ${credentials.pid} listening on: [${listeningPorts.join(', ')}]`);

		const apiPort = await this.findWorkingPort(listeningPorts, credentials.csrfToken);
		if (!apiPort) {
			this.logger.warn('No listening port responded to API probe');
			return null;
		}

		return { pid: credentials.pid, port: apiPort, csrfToken: credentials.csrfToken };
	}

	private async findOnUnix(pgrepCmd: string): Promise<ServerInfo | null> {
		const { stdout } = await execAsync(pgrepCmd);
		const line = stdout.split('\n').find(l => l.includes('--csrf_token'));
		if (!line) { return null; }

		const parts = line.trim().split(/\s+/);
		const pid = parseInt(parts[0], 10);
		const credentials = this.extractCredentials(pid, line);
		if (!credentials) { return null; }

		const listeningPorts = await this.getListeningPortsUnix(pid);
		const apiPort = await this.findWorkingPort(listeningPorts, credentials.csrfToken);
		if (!apiPort) { return null; }

		return { pid, port: apiPort, csrfToken: credentials.csrfToken };
	}

	// ─── Credential extraction ────────────────────────────────────────────────

	private extractCredentials(pid: number, cmdLine: string): { pid: number; csrfToken: string } | null {
		// --csrf_token is used for the HTTP API
		const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
		if (!tokenMatch) {
			this.logger.warn('--csrf_token not found in language server command line');
			return null;
		}
		return { pid, csrfToken: tokenMatch[1] };
	}

	// ─── Port discovery ───────────────────────────────────────────────────────

	private async getListeningPortsWindows(pid: number): Promise<number[]> {
		try {
			const { stdout } = await execAsync(
				`powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json"`
			);
			const parsed = JSON.parse(stdout.trim());
			const ports = Array.isArray(parsed) ? parsed : [parsed];
			return ports.filter((p: any) => typeof p === 'number').sort((a: number, b: number) => a - b);
		} catch {
			return [];
		}
	}

	private async getListeningPortsUnix(pid: number): Promise<number[]> {
		try {
			const { stdout } = await execAsync(
				`lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null || ss -tlnp | grep "pid=${pid}"`
			);
			const ports: number[] = [];
			const regex = /:(\d+)\s+\(LISTEN\)/g;
			let m: RegExpExecArray | null;
			while ((m = regex.exec(stdout)) !== null) {
				const p = parseInt(m[1], 10);
				if (!ports.includes(p)) { ports.push(p); }
			}
			return ports.sort((a, b) => a - b);
		} catch {
			return [];
		}
	}

	/**
	 * Tests each port with a lightweight probe request.
	 * Returns the first port that responds with HTTP 200.
	 */
	private async findWorkingPort(ports: number[], csrfToken: string): Promise<number | null> {
		for (const port of ports) {
			const ok = await this.probePort(port, csrfToken);
			if (ok) {
				this.logger.info(`API port found: ${port}`);
				return port;
			}
		}
		return null;
	}

	private probePort(port: number, csrfToken: string): Promise<boolean> {
		return new Promise((resolve) => {
			const body = JSON.stringify({ wrapper_data: {} });
			const req = http.request({
				hostname: '127.0.0.1',
				port,
				path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body),
					'Connect-Protocol-Version': '1',
					'X-Codeium-Csrf-Token': csrfToken,
				},
				timeout: 2000,
			}, (res) => {
				res.resume(); // drain
				resolve(res.statusCode === 200);
			});
			req.on('error', () => resolve(false));
			req.on('timeout', () => { req.destroy(); resolve(false); });
			req.write(body);
			req.end();
		});
	}

	// ─── HTTP client ──────────────────────────────────────────────────────────

	request<T>(info: ServerInfo, path: string, body: object): Promise<T> {
		return new Promise((resolve, reject) => {
			const data = JSON.stringify(body);
			const req = http.request({
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
			}, (res) => {
				let responseBody = '';
				res.on('data', (chunk) => (responseBody += chunk));
				res.on('end', () => {
					try {
						resolve(JSON.parse(responseBody) as T);
					} catch {
						reject(new Error(`Invalid JSON (status ${res.statusCode}): ${responseBody.substring(0, 120)}`));
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
