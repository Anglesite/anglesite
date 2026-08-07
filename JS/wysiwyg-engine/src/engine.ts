import type { BlockModel, BlockId, HostTransport, Op, OpResult, EngineEvent } from "./types.js";
import type { Point } from "./hit-test.js";
import { ModelSync } from "./model-sync.js";
import { SelectionState } from "./selection.js";
import { OpQueue } from "./op-queue.js";
import { hitTest } from "./hit-test.js";

/**
 * The portable overlay engine core (spec §3.1). Wires model sync, selection, hit-testing, and the
 * op queue together behind one event stream. Owns nothing about rendering — a host (or, in this
 * slice's tests, e2e/fixture-page.ts) subscribes via `onEvent` and re-renders its own DOM
 * projection in response; the engine never touches the DOM itself.
 */
export class WysiwygEngine {
  readonly modelSync: ModelSync;
  readonly selection = new SelectionState();
  readonly opQueue: OpQueue;

  #listeners = new Set<(event: EngineEvent) => void>();
  #unsubscribeModel: () => void;
  #unsubscribeSelection: () => void;
  #unsubscribeOps: () => void;

  constructor(initialModel: BlockModel, transport: HostTransport) {
    this.modelSync = new ModelSync(initialModel);
    this.opQueue = new OpQueue(transport, this.modelSync);

    this.#unsubscribeModel = transport.onModelUpdate((model) => {
      this.modelSync.applyModel(model);
      this.#emit({ type: "model-updated", model });
    });
    this.#unsubscribeSelection = this.selection.onChange((blockId) => {
      this.#emit({ type: "selection-changed", blockId });
    });
    this.#unsubscribeOps = this.opQueue.onEvent((event) => this.#emit(event));
  }

  hitTest(point: Point, doc: Document = document): BlockId | null {
    return hitTest(point, doc);
  }

  submit(op: Op): Promise<OpResult> {
    return this.opQueue.submit(op);
  }

  onEvent(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#unsubscribeModel();
    this.#unsubscribeSelection();
    this.#unsubscribeOps();
  }

  #emit(event: EngineEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
