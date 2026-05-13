import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { Config } from '../utils/config';
import { Logger } from '../utils/logger';

/**
 * Plays audio notifications using native OS commands.
 * No external npm dependencies — uses PowerShell (Windows),
 * afplay (macOS), or aplay/paplay (Linux).
 */
export class AudioNotifier {
	private readonly soundsDir: string;

	constructor(
		private context: vscode.ExtensionContext,
		private config: Config,
		private logger: Logger,
	) {
		this.soundsDir = path.join(context.extensionPath, 'media', 'sounds');
	}

	playApprovalNeeded(): void {
		if (!this.config.isSoundEnabled()) {return;}
		this.play('approval-needed.wav');
	}

	playPromptComplete(): void {
		if (!this.config.isSoundEnabled()) {return;}
		this.play('prompt-complete.wav');
	}

	private play(filename: string): void {
		const filePath = path.join(this.soundsDir, filename);
		const volume = this.config.getSoundVolume();

		const command = this.buildPlayCommand(filePath, volume);
		if (!command) {
			this.logger.warn(`Unsupported platform for audio: ${process.platform}`);
			return;
		}

		exec(command, (error) => {
			if (error) {
				this.logger.error(`Failed to play ${filename}`, error);
			}
		});
	}

	private buildPlayCommand(filePath: string, volume: number): string | null {
		const escapedPath = filePath.replace(/"/g, '\\"');

		switch (process.platform) {
			case 'win32': {
				// PowerShell with SoundPlayer — volume via system volume
				const volumeFraction = volume / 100;
				return `powershell -NoProfile -Command "` +
					`$player = New-Object System.Media.SoundPlayer '${escapedPath}'; ` +
					`$player.PlaySync()"`;
			}
			case 'darwin': {
				// macOS afplay — volume 0.0 to 1.0
				const macVolume = (volume / 100).toFixed(2);
				return `afplay -v ${macVolume} "${escapedPath}"`;
			}
			case 'linux': {
				// Try paplay (PulseAudio) first, fall back to aplay (ALSA)
				const linuxVolume = Math.round(volume * 655.35); // paplay uses 0-65535
				return `paplay --volume=${linuxVolume} "${escapedPath}" 2>/dev/null || ` +
					`aplay "${escapedPath}" 2>/dev/null`;
			}
			default:
				return null;
		}
	}
}
