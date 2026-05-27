export class ForeignMcpSecretRefError extends Error {
  readonly code = "FOREIGN_MCP_SECRET_REF" as const;

  constructor(
    readonly serverId: string,
    readonly path: readonly string[],
    readonly refServerId: string,
  ) {
    super(
      `MCP config references a Keychain secret owned by server ${refServerId} at ${path.join(".")}`,
    );
    this.name = "ForeignMcpSecretRefError";
  }
}
