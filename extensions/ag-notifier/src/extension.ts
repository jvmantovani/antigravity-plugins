import * as vscode from 'vscode';
import { ApprovalDetector } from './core/approvalDetector';
import { CompletionDetector } from './core/completionDetector';
import { AudioNotifier } from './notifiers/audioNotifier';
import { OsNotifier } from './notifiers/osNotifier';
import { Config } from './utils/config';
import { Logger } from './utils/logger';

let approvalDetector: ApprovalDetector | undefined;
let completionDetector: CompletionDetector | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const logger = new Logger('AG Notifier');
	logger.info('Activating AG Notifier...');

	const config = new Config();
	const audioNotifier = new AudioNotifier(context, config, logger);
	const osNotifier = new OsNotifier(config, logger);

	// Initialize detectors
	approvalDetector = new ApprovalDetector(config, logger, (event) => {
		logger.info(`Approval needed: ${event.message}`);
		audioNotifier.playApprovalNeeded();
		osNotifier.notifyApprovalNeeded(event.message);
	});

	completionDetector = new CompletionDetector(config, logger, (event) => {
		logger.info(`Prompt complete: ${event.message}`);
		audioNotifier.playPromptComplete();
		osNotifier.notifyPromptComplete(event.message);
	});

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('ag-notifier.testSound', () => {
			audioNotifier.playApprovalNeeded();
			osNotifier.notifyApprovalNeeded('Test notification — AG Notifier is working!');
		}),

		vscode.commands.registerCommand('ag-notifier.toggleEnabled', () => {
			const current = config.isEnabled();
			const target = !current;
			vscode.workspace.getConfiguration('ag-notifier').update('enabled', target, true);
			vscode.window.showInformationMessage(
				`AG Notifier ${target ? 'enabled' : 'disabled'}.`
			);
		}),

		// React to config changes
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('ag-notifier')) {
				config.reload();
				logger.info('Configuration reloaded.');
			}
		}),

		// Start detectors
		approvalDetector,
		completionDetector,
	);

	// Start monitoring
	approvalDetector.start();
	completionDetector.start();

	logger.info('AG Notifier activated successfully.');
}

export function deactivate(): void {
	approvalDetector?.dispose();
	completionDetector?.dispose();
}
