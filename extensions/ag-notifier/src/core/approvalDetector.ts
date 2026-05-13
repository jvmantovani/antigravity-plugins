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
 * Strategy: Monitor VS Code's window state. When the window becomes
 * focused after being inactive, and there are pending information messages
 * or the terminal shows approval patterns, fire the callback.
 *
 * Future improvement: Hook into Antigravity's language server API
 * (like AntigravityQuota does) to get precise event data.
 */
export class ApprovalDetector implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private isRunning = false;

	constructor(
		private config: Config,
		private logger: Logger,
		private onApprovalNeeded: DetectorCallback,
	) {}

	start(): void {
		if (this.isRunning) {return;}
		this.isRunning = true;

		// Strategy 1: Monitor terminal output for approval patterns
		// onDidWriteTerminalData is a proposed API — may not exist in all VS Code builds
		const windowAny = vscode.window as any;
		const terminalListener = windowAny.onDidWriteTerminalData?.((e: any) => {
			if (!this.config.isApprovalEventEnabled()) {return;}

			const data: string = e.data;
			// Common patterns when Antigravity asks for approval
			const approvalPatterns = [
				/\(y\/n\)/i,
				/\[Y\/n\]/,
				/\[yes\/no\]/i,
				/approve\?/i,
				/accept\?/i,
				/Do you want to proceed/i,
				/waiting for.*approval/i,
			];

			for (const pattern of approvalPatterns) {
				if (pattern.test(data)) {
					this.onApprovalNeeded({
						message: 'Antigravity is waiting for your approval',
						timestamp: new Date(),
					});
					break;
				}
			}
		});

		if (terminalListener) {
			this.disposables.push(terminalListener);
			this.logger.info('Terminal approval detection active.');
		} else {
			this.logger.warn(
				'onDidWriteTerminalData not available — terminal monitoring disabled. ' +
				'This is a proposed API and may require enabledApiProposals.'
			);
		}

		// Strategy 2: Monitor window focus changes
		// When the user returns to VS Code, check if something is pending
		const focusListener = vscode.window.onDidChangeWindowState((state) => {
			if (state.focused && this.config.isApprovalEventEnabled()) {
				// The focus change itself is useful — a notification sound
				// when returning to the editor reminds users there may be
				// pending actions. We'll refine this with better heuristics.
				this.logger.info('Window regained focus — checking for pending approvals.');
			}
		});
		this.disposables.push(focusListener);

		this.logger.info('Approval detector started.');
	}

	dispose(): void {
		this.isRunning = false;
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
