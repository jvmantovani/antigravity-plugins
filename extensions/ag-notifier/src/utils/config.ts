import * as vscode from 'vscode';

/**
 * Centralized config reader for ag-notifier settings.
 * Reads from VS Code's workspace configuration.
 */
export class Config {
	private config!: vscode.WorkspaceConfiguration;

	constructor() {
		this.reload();
	}

	reload(): void {
		this.config = vscode.workspace.getConfiguration('ag-notifier');
	}

	isEnabled(): boolean {
		return this.config.get<boolean>('enabled', true);
	}

	isSoundEnabled(): boolean {
		return this.isEnabled() && this.config.get<boolean>('sound.enabled', true);
	}

	getSoundVolume(): number {
		return this.config.get<number>('sound.volume', 50);
	}

	isNotificationEnabled(): boolean {
		return this.isEnabled() && this.config.get<boolean>('notification.enabled', true);
	}

	isEditorNotificationEnabled(): boolean {
		return this.isEnabled() && this.config.get<boolean>('notification.showInEditor', true);
	}

	isApprovalEventEnabled(): boolean {
		return this.isEnabled() && this.config.get<boolean>('events.onApprovalNeeded', true);
	}

	isPromptCompleteEventEnabled(): boolean {
		return this.isEnabled() && this.config.get<boolean>('events.onPromptComplete', true);
	}
}
