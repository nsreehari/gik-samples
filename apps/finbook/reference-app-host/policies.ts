export interface EndpointPolicy {
  authorizeEndpoint(kind: string, endpoint: URL): boolean | Promise<boolean>;
}

export interface CredentialPolicy {
  resolveCredential(reference: string): Promise<unknown>;
  clearCredential?(reference: string): void | Promise<void>;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export const localDevelopmentEndpointPolicy: EndpointPolicy = {
  authorizeEndpoint: (kind, endpoint) => kind === "mcp"
    && (endpoint.protocol === "https:"
      || (endpoint.protocol === "http:" && isLoopback(endpoint.hostname))),
};
