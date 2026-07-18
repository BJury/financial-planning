import type { IncomeDrainDefinition, IncomeSourceDefinition } from "./types.js";

/**
 * `any` here (not `never`/`unknown`) is a deliberate, contained type
 * erasure: a registry storing heterogeneous `IncomeSourceDefinition<T>`
 * instances for many different, unrelated `T`s has no sound way to
 * express that at the storage layer — each caller's own generic
 * `registerIncomeSource<TConfig>`/`getIncomeSource` signature is what
 * keeps the *public* API fully typed. This is the standard shape for a
 * heterogeneous plugin registry, not a general licence to use `any`
 * elsewhere in the engine.
 */
type AnyIncomeSourceDefinition = IncomeSourceDefinition<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type AnyIncomeDrainDefinition = IncomeDrainDefinition<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The shared registry the simulation loop, the UI's "+ Add income
 * source"/"+ Add drain" picker, and input validation all read from
 * (SPEC.md §9.4). Registering a new catalog type means adding one module
 * and one registration call — nothing else changes.
 */
class CatalogRegistry {
  private readonly incomeSources = new Map<string, AnyIncomeSourceDefinition>();
  private readonly incomeDrains = new Map<string, AnyIncomeDrainDefinition>();

  registerIncomeSource<TConfig>(definition: IncomeSourceDefinition<TConfig>): void {
    if (this.incomeSources.has(definition.type)) {
      throw new Error(`Duplicate income source type registered: "${definition.type}"`);
    }
    this.incomeSources.set(definition.type, definition as AnyIncomeSourceDefinition);
  }

  registerIncomeDrain<TConfig>(definition: IncomeDrainDefinition<TConfig>): void {
    if (this.incomeDrains.has(definition.type)) {
      throw new Error(`Duplicate income drain type registered: "${definition.type}"`);
    }
    this.incomeDrains.set(definition.type, definition as AnyIncomeDrainDefinition);
  }

  getIncomeSource(type: string): AnyIncomeSourceDefinition {
    const definition = this.incomeSources.get(type);
    if (!definition) {
      throw new Error(`No income source type registered as "${type}"`);
    }
    return definition;
  }

  getIncomeDrain(type: string): AnyIncomeDrainDefinition {
    const definition = this.incomeDrains.get(type);
    if (!definition) {
      throw new Error(`No income drain type registered as "${type}"`);
    }
    return definition;
  }

  listIncomeSources(): readonly AnyIncomeSourceDefinition[] {
    return [...this.incomeSources.values()];
  }

  listIncomeDrains(): readonly AnyIncomeDrainDefinition[] {
    return [...this.incomeDrains.values()];
  }
}

export const registry = new CatalogRegistry();
