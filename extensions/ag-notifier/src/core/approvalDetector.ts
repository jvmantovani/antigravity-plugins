import * as vscode from 'vscode';
import { Config } from '../utils/config';
import { Logger } from '../utils/logger';
import { ServerConnector } from './serverConnector';

export interface DetectorEvent {
	message: string;
	timestamp: Date;
}

export type DetectorCallback = (event: DetectorEvent) => void;

interface AgentState {
	isThinking: boolean;
	awaitingInput: boolean;
	lastActivity: Date;
}

/**
 * Detects when Antigravity is waiting for user approval.
 *
 * Primary strategy: Poll the language server's GetUserStatus endpoint
 * to observe agent state changes. When the agent was thinking and then
 * becomes idle (stops producing output), it likely needs user input.
 *
 * Secondary strategy: Monitor terminal and window focus events.
 */
export class ApprovalDetector implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private isRunning = false;
	private pollingTimer?: NodeJS.Timeout;
	private lastState: AgentState = { isThinking: false, awaitingInput: false, lastActivity: new Date(0) };
	private serverConnector: ServerConnector;

	// Debounce: only fire if state has been stable for this duration
	private readonly IDLE_THRESHOLD_MS = 3000;
	private readonly POLL_INTERVAL_MS = 2000;

	constructor(
		private config: Config,
		private logger: Logger,
		private onApprovalNeeded: DetectorCallback,
	) {
		this.serverConnector = new ServerConnector(logger);
	}

	start(): void {
		if (this.isRunning) {return;}
		this.isRunning = true;

		// Primary: poll language server for state changes
		this.startPolling();

		// Secondary: window focus — user returning to editor suggests something needs attention
		const focusListener = vscode.window.onDidChangeWindowState((state) => {
			if (state.focused && this.config.isApprovalEventEnabled()) {
				this.logger.info('Window regained focus.');
			}
		});
		this.disposables.push(focusListener);

		// Secondary: new terminal opened by agent
		const terminalOpenListener = vscode.window.onDidOpenTerminal((terminal) => {
			this.logger.info(`Terminal opened: "${terminal.name}"`);
		});
		this.disposables.push(terminalOpenListener);

		this.logger.info('Approval detector started.');
	}

	private startPolling(): void {
		this.pollingTimer = setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
	}

	private async poll(): Promise<void> {
		if (!this.config.isApprovalEventEnabled()) {return;}

		try {
			const info = await this.serverConnector.discover();
			if (!info) {
				this.logger.warn('Language server not found — will retry.');
				return;
			}

			const response = await this.serverConnector.request<any>(info,
				'/exa.language_server_pb.LanguageServerService/GetUserStatus',
				{ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } }
			);

			// Log the full response once for debugging (first time only)
			if (this.lastState.lastActivity.getTime() === 0) {
				this.logger.info(`Language server connected. Response keys: ${Object.keys(response || {}).join(', ')}`);
			}

			this.updateState(response);

		} catch (err) {
			// Invalidate cache so we rediscover on next poll (port may have changed)
			this.serverConnector.invalidateCache();
			this.logger.warn(`Poll failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private updateState(response: any): void {
		const now = new Date();
		const userStatus = response?.userStatus;

		if (!userStatus) {return;}

		// Log any state fields we can observe
		const stateKeys = Object.keys(userStatus);
		if (stateKeys.length > 0 && this.lastState.lastActivity.getTime() === 0) {
			this.logger.info(`UserStatus fields available: ${stateKeys.join(', ')}`);
		}

		this.lastState.lastActivity = now;
	}

	dispose(): void {
		this.isRunning = false;
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
			this.pollingTimer = undefined;
		}
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
