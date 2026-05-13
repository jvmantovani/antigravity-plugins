import * as vscode from 'vscode';
import { Config } from '../utils/config';
import { Logger } from '../utils/logger';

export interface DetectorEvent {
	message: string;
	timestamp: Date;
}

export type DetectorCallback = (event: DetectorEvent) => void;

/**
 * Detects when Antigravity is waiting for user approval.
 *
 * Strategy: Monitor active terminal changes and window focus state.
 * When a new terminal becomes active or the window regains focus,
 * it may indicate the agent is waiting for user input.
 *
 * Future improvement: Hook into Antigravity's language server API
 * (like AntigravityQuota does) to get precise event data, or
 * use a FileSystemWatcher on Antigravity's internal log/state files.
 */
export class ApprovalDetector implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private isRunning = false;
	private lastTerminalCount = 0;

	constructor(
		private config: Config,
		private logger: Logger,
		private onApprovalNeeded: DetectorCallback,
	) {}

	start(): void {
		if (this.isRunning) {return;}
		this.isRunning = true;

		this.lastTerminalCount = vscode.window.terminals.length;

		// Strategy 1: Detect when a new terminal opens
		// Antigravity opens terminals for tool execution; a burst of new
		// terminals followed by silence may indicate a pending approval
		const terminalOpenListener = vscode.window.onDidOpenTerminal((terminal) => {
			if (!this.config.isApprovalEventEnabled()) {return;}

			const name = terminal.name.toLowerCase();
			this.logger.info(`Terminal opened: "${terminal.name}"`);

			// Track terminal names that suggest agent activity
			const agentPatterns = ['task', 'agent', 'antigravity', 'gemini', 'claude'];
			if (agentPatterns.some(p => name.includes(p))) {
				this.logger.info('Agent-related terminal detected — monitoring for activity.');
			}
		});
		this.disposables.push(terminalOpenListener);

		// Strategy 2: Monitor active terminal changes
		// A switch to a specific terminal may indicate the agent is
		// surfacing something for the user
		const activeTerminalListener = vscode.window.onDidChangeActiveTerminal((terminal) => {
			if (!this.config.isApprovalEventEnabled() || !terminal) {return;}
			this.logger.info(`Active terminal changed to: "${terminal.name}"`);
		});
		this.disposables.push(activeTerminalListener);

		// Strategy 3: Monitor window focus
		// When the editor regains focus, there may be pending approvals
		const focusListener = vscode.window.onDidChangeWindowState((state) => {
			if (state.focused && this.config.isApprovalEventEnabled()) {
				this.logger.info('Window regained focus — user returned to editor.');
			}
		});
		this.disposables.push(focusListener);

		// Strategy 4: Watch for Antigravity state files
		// The Antigravity agent may write status to files we can observe
		this.setupFileWatcher();

		this.logger.info('Approval detector started (stable APIs only).');
	}

	private setupFileWatcher(): void {
		// Watch for common Antigravity state/log patterns
		// These paths will be refined once we understand AG's internal structure
		const patterns = [
			'**/.antigravity/**/state.json',
			'**/.gemini/**/state.json',
		];

		for (const pattern of patterns) {
			try {
				const watcher = vscode.workspace.createFileSystemWatcher(pattern);
				watcher.onDidChange((uri) => {
					if (!this.config.isApprovalEventEnabled()) {return;}
					this.logger.info(`State file changed: ${uri.fsPath}`);
					// TODO: Parse the state file to detect approval-needed state
				});
				this.disposables.push(watcher);
				this.logger.info(`File watcher active for: ${pattern}`);
			} catch {
				this.logger.warn(`Could not create watcher for: ${pattern}`);
			}
		}
	}

	dispose(): void {
		this.isRunning = false;
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
