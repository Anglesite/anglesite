import Foundation

/// Builds the wire-format `EditMessage` payloads for the four Component Editor structure write
/// ops (`insert-node`, `move-node`, `remove-node`, `set-attr`). Pure and testable — no MCP/router
/// dependency, mirrors `ComponentStyleEditBuilder`'s shape exactly.
public enum ComponentStructureEditBuilder {
    /// New-node spec for `insertNode` — mirrors the plugin's `component.node` schema.
    public enum NodeSpec: Equatable, Codable {
        /// A plain HTML element, inserted by tag name — the plugin owns what the new element's
        /// markup looks like, so the app only names the tag.
        case element(tag: String)
        /// A project-component instance. `componentPath` is the component's project-relative
        /// path — the plugin resolves the actual import specifier relative to the *edited*
        /// file and adds the frontmatter `import` itself, so the app never computes `../`
        /// chains.
        case component(tag: String, componentPath: String)
        /// A `<slot>` outlet; `name` maps to the wire's `slotName` for a named slot, omitted
        /// entirely (not sent as null) for the default slot.
        case slot(name: String? = nil)

        var jsonValue: JSONValue {
            switch self {
            case .element(let tag):
                return .object(["kind": .string("element"), "tag": .string(tag)])
            case .component(let tag, let componentPath):
                return .object(["kind": .string("component"), "tag": .string(tag), "componentPath": .string(componentPath)])
            case .slot(let name):
                var obj: [String: JSONValue] = ["kind": .string("slot")]
                if let name { obj["slotName"] = .string(name) }
                return .object(obj)
            }
        }
    }

    /// Builds the `insert-node` message: add `node` under `parentId` at child position `index`.
    /// `baseVersion` is the model's content hash (``ComponentModel/version``) — the plugin
    /// rejects the edit if the file changed since that model was fetched, which is the only
    /// thing keeping node-id-addressed edits safe against concurrent modification.
    public static func insertNode(
        id: String,
        path: String,
        baseVersion: String,
        parentId: String,
        index: Int,
        node: NodeSpec
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.insertNode,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "parentId": .string(parentId),
                "index": .int(index),
                "node": node.jsonValue,
            ]),
            value: nil
        )
    }

    /// Builds the `move-node` message: reparent/reorder `nodeId` under `newParentId` at
    /// `newIndex`. The plugin computes `newIndex` against the child list *after* removing the
    /// dragged node — a same-parent move where the node started earlier must pre-adjust via
    /// ``ComponentOutline/adjustedMoveIndex(targetIndex:draggedIndex:)`` or land one slot off.
    public static func moveNode(
        id: String,
        path: String,
        baseVersion: String,
        nodeId: String,
        newParentId: String,
        newIndex: Int
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.moveNode,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "nodeId": .string(nodeId),
                "newParentId": .string(newParentId),
                "newIndex": .int(newIndex),
            ]),
            value: nil
        )
    }

    /// Builds the `remove-node` message: delete `nodeId` and its whole subtree. Same
    /// `baseVersion` staleness guard as ``insertNode(id:path:baseVersion:parentId:index:node:)``.
    public static func removeNode(
        id: String,
        path: String,
        baseVersion: String,
        nodeId: String
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.removeNode,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "nodeId": .string(nodeId),
            ]),
            value: nil
        )
    }

    /// Carve the subtree rooted at `nodeId` out into a brand-new `.astro` component, replacing the
    /// extracted markup with a self-closing instance + import. The plugin applies this as one
    /// atomic two-file edit. `newName` is a bare PascalCase identifier (no path, no `.astro`
    /// suffix) — the server derives the full path itself as `src/components/<newName>.astro` and
    /// validates the name against a strict PascalCase-identifier regex. Adds `newName` to the
    /// standard `{ path, baseVersion, nodeId }` structure-op payload.
    public static func extractComponent(
        id: String,
        path: String,
        baseVersion: String,
        nodeId: String,
        newName: String
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.extractComponent,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "nodeId": .string(nodeId),
                "newName": .string(newName),
            ]),
            value: nil
        )
    }

    /// `value: nil` removes the attribute (encodes as an explicit JSON `null`, distinct from
    /// omitting the field — the plugin schema treats `value === null` as "remove").
    public static func setAttr(
        id: String,
        path: String,
        baseVersion: String,
        nodeId: String,
        name: String,
        value: String?
    ) -> EditMessage {
        EditMessage(
            id: id,
            path: path,
            selector: nil,
            op: EditMessage.Op.setAttr,
            component: .object([
                "path": .string(path),
                "baseVersion": .string(baseVersion),
                "nodeId": .string(nodeId),
                "name": .string(name),
                "value": value.map(JSONValue.string) ?? .null,
            ]),
            value: nil
        )
    }
}
