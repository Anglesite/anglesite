import type { HostTransport, Op, OpEnvelope, OpResult, BlockModel, OpRejectionReason } from "./types.js";
import { invertOp } from "./ops.js";
import { ModelSync } from "./model-sync.js";

export interface AppliedEvent {
  type: "applied";
  op: Op;
  inverse: Op;
  model: BlockModel;
}

export interface RejectedEvent {
  type: "rejected";
  op: Op;
  reason: OpRejectionReason;
  message?: string;
  /**
   * The host's fresh model, present only when one arrived with the rejection and was adopted into
   * `ModelSync` (version-mismatch). A rejection that carries this is also a *render* trigger: the
   * engine's model moved even though the op did not apply, so a consumer that re-renders on
   * "applied"/"model-updated" alone would leave its DOM projection showing the pre-rejection model
   * while the engine holds the host's newer one.
   */
  model?: BlockModel;
}

export type OpQueueEvent = AppliedEvent | RejectedEvent;

let counter = 0;
function nextOpId(): string {
  counter += 1;
  return `op-${counter}`;
}

/**
 * Submits ops to the host and turns every outcome into an event a caller must observe — the
 * mechanism behind spec §9's "no silent loss." A rejection is never swallowed: it is always an
 * emitted `RejectedEvent`, and on version-mismatch the fresh model is adopted into `modelSync`
 * before the event fires, so `retry()` (the "replay" half of §9) targets current state.
 *
 * Not serialized: `submit()` does not queue or order concurrent calls. Every submission stamps its
 * envelope with the model version current *at call time*, so two overlapping submissions against a
 * host that advances its version per applied op both send the older version and the second
 * spuriously version-mismatches. Callers in this slice submit one op per gesture, so this is not
 * yet observable; real request serialization (a single in-flight op with the rest queued behind it,
 * re-stamped as each completes) is deferred to a later slice.
 */
export class OpQueue {
  #transport: HostTransport;
  #modelSync: ModelSync;
  #listeners = new Set<(event: OpQueueEvent) => void>();

  constructor(transport: HostTransport, modelSync: ModelSync) {
    this.#transport = transport;
    this.#modelSync = modelSync;
  }

  onEvent(listener: (event: OpQueueEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async submit(op: Op): Promise<OpResult> {
    const envelope: OpEnvelope = { id: nextOpId(), targetVersion: this.#modelSync.version, op };
    const result = await this.#transport.sendOp(envelope);

    if (result.status === "applied") {
      this.#modelSync.applyModel(result.model);
      this.#emit({ type: "applied", op, inverse: invertOp(op), model: result.model });
      return result;
    }

    let adopted: BlockModel | undefined;
    if (result.reason === "version-mismatch" && result.freshModel) {
      this.#modelSync.applyModel(result.freshModel);
      adopted = result.freshModel;
    }
    this.#emit({ type: "rejected", op, reason: result.reason, message: result.message, model: adopted });
    return result;
  }

  /** Re-submits `op` against the current model version — the "replay" outcome of spec §9's
   *  rejection handling. Callers choose "drop" simply by not calling this. */
  retry(op: Op): Promise<OpResult> {
    return this.submit(op);
  }

  #emit(event: OpQueueEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
