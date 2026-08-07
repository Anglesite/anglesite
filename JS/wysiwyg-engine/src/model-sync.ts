import type { BlockModel, BlockId, BlockNode } from "./types.js";

/** Holds the engine's current view of one page's block model and answers the staleness question
 *  every op-targeting decision depends on (spec §3.2/§9: versioning by content hash). */
export class ModelSync {
  #model: BlockModel;

  constructor(initialModel: BlockModel) {
    this.#model = initialModel;
  }

  get current(): BlockModel {
    return this.#model;
  }

  get version(): string {
    return this.#model.version;
  }

  isStale(targetVersion: string): boolean {
    return targetVersion !== this.#model.version;
  }

  applyModel(model: BlockModel): void {
    if (model.path !== this.#model.path) {
      throw new Error(`ModelSync: model path changed from ${this.#model.path} to ${model.path}`);
    }
    this.#model = model;
  }

  getBlock(id: BlockId): BlockNode | undefined {
    return this.#model.blocks[id];
  }
}
