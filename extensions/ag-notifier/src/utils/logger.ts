import * as vscode from 'vscode';

/**
 * Simple logger that writes to a VS Code Output Channel.
 */
export class Logger {
	private channel: vscode.OutputChannel;

	constructor(name: string) {
		this.channel = vscode.window.createOutputChannel(name);
	}

	info(message: string): void {
		this.log('INFO', message);
	}

	warn(message: string): void {
		this.log('WARN', message);
	}

	error(message: string, err?: unknown): void {
		const errMsg = err instanceof Error ? err.message : String(err ?? '');
		this.log('ERROR', errMsg ? `${message}: ${errMsg}` : message);
	}

	private log(level: string, message: string): void {
		const timestamp = new Date().toISOString();
		this.channel.appendLine(`[${timestamp}] [${level}] ${message}`);
	}

	show(): void {
		this.channel.show();
	}

	dispose(): void {
		this.channel.dispose();
	}
}
