import * as vscode from 'vscode';
import { Config } from '../utils/config';
import { Logger } from '../utils/logger';

/**
 * Shows notifications via VS Code toasts and native OS notifications.
 * Uses only the VS Code API — no external dependencies.
 *
 * Note: VS Code's showInformationMessage already triggers native OS
 * notifications when the window is not focused, so we get both
 * in-editor and OS-level notifications for free.
 */
export class OsNotifier {
	constructor(
		private config: Config,
		private logger: Logger,
	) {}

	notifyApprovalNeeded(message: string): void {
		if (!this.config.isNotificationEnabled()) {return;}

		if (this.config.isEditorNotificationEnabled()) {
			vscode.window.showWarningMessage(
				`🔔 ${message}`,
				'Go to Terminal'
			).then((action) => {
				if (action === 'Go to Terminal') {
					vscode.commands.executeCommand('workbench.action.terminal.focus');
				}
			});
		}
	}

	notifyPromptComplete(message: string): void {
		if (!this.config.isNotificationEnabled()) {return;}

		if (this.config.isEditorNotificationEnabled()) {
			vscode.window.showInformationMessage(
				`✅ ${message}`
			);
		}
	}
}
