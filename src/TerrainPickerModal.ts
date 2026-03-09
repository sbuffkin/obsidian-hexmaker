import { App, Modal } from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { getIconUrl } from "./utils";

export class TerrainPickerModal extends Modal {
	constructor(
		app: App,
		private plugin: DuckmagePlugin,
		private onSelect: (terrainName: string | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("duckmage-hex-editor");
		contentEl.createEl("h2", { text: "Paint terrain" });

		const section = contentEl.createDiv({ cls: "duckmage-editor-section" });
		const grid = section.createDiv({ cls: "duckmage-terrain-picker duckmage-terrain-picker-full" });

		// Clear terrain option
		const clearBtn = grid.createDiv({ cls: "duckmage-terrain-option duckmage-terrain-option-clear" });
		clearBtn.createDiv({ cls: "duckmage-terrain-preview duckmage-terrain-preview-clear" });
		clearBtn.createSpan({ text: "Clear", cls: "duckmage-terrain-option-name" });
		clearBtn.addEventListener("click", () => {
			this.onSelect(null);
			this.close();
		});

		for (const entry of this.plugin.settings.terrainPalette) {
			const btn = grid.createDiv({ cls: "duckmage-terrain-option" });
			const preview = btn.createDiv({ cls: "duckmage-terrain-preview" });
			preview.style.backgroundColor = entry.color;

			if (entry.icon) {
				const img = preview.createEl("img", { cls: "duckmage-terrain-preview-icon" });
				img.src = getIconUrl(this.plugin, entry.icon);
				img.alt = entry.name;
			}

			btn.createSpan({ text: entry.name, cls: "duckmage-terrain-option-name" });

			btn.addEventListener("click", () => {
				this.onSelect(entry.name);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
