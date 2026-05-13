import * as vscode from 'vscode';
import { Config } from '../utils/config';
import { Logger } from '../utils/logger';
import type { DetectorCallback } from './approvalDetector';

/**
 * Detects when Antigravity finishes processing a prompt.
 *
 * Strategy: Monitor terminal shell execution lifecycle.
 * When a shell command ends in a terminal, it likely means
 * the AI agent has completed its work.
 *
 * Future improvement: Connect to Antigravity's language server
 * to receive precise "task complete" events.
 */
export class CompletionDetector implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private isRunning = false;

	constructor(
		private config: Config,
		private logger: Logger,
		private onPromptComplete: DetectorCallback,
	) {}

	start(): void {
		if (this.isRunning) {return;}
		this.isRunning = true;

		// Strategy 1: Shell Integration API (stable)
		// Fires when a command finishes executing in the terminal
		if (vscode.window.onDidEndTerminalShellExecution) {
			const shellListener = vscode.window.onDidEndTerminalShellExecution((e) => {
				if (!this.config.isPromptCompleteEventEnabled()) {return;}

				// Only notify if the terminal belongs to an agent-like process
				const terminalName = e.terminal.name.toLowerCase();
				const agentTerminalPatterns = ['antigravity', 'gemini', 'agent', 'task'];

				const isAgentTerminal = agentTerminalPatterns.some(p =>
					terminalName.includes(p)
				);

				if (isAgentTerminal) {
					this.onPromptComplete({
						message: `Task completed in "${e.terminal.name}"`,
						timestamp: new Date(),
					});
				}
			});
			this.disposables.push(shellListener);
			this.logger.info('Shell execution completion detection active.');
		} else {
			this.logger.warn(
				'onDidEndTerminalShellExecution not available — ' +
				'falling back to terminal close detection.'
			);

			// Fallback: detect when terminals close
			const closeListener = vscode.window.onDidCloseTerminal((terminal) => {
				if (!this.config.isPromptCompleteEventEnabled()) {return;}

				const terminalName = terminal.name.toLowerCase();
				if (terminalName.includes('task') || terminalName.includes('agent')) {
					this.onPromptComplete({
						message: `Terminal "${terminal.name}" closed — task may be complete`,
						timestamp: new Date(),
					});
				}
			});
			this.disposables.push(closeListener);
		}

		this.logger.info('Completion detector started.');
	}

	dispose(): void {
		this.isRunning = false;
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
