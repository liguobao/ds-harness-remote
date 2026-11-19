import { PROTOCOL_HEADER, PROTOCOL_VERSION } from "./protocol/index.js";

export type TunnelErrorCode =
	| "upgrade_required"
	| "rate_limited"
	| "tunnel_gone"
	| "replaced"
	| "unauthorized"
	| "server_error"
	| "network_error";

export class TunnelError extends Error {
	override name = "TunnelError";
	readonly code: TunnelErrorCode;

	constructor(code: TunnelErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.code = code;
	}
}

export const PROTOCOL_HEADERS = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) };

export function errorFromResponse(status: number, text: string): TunnelError {
	let message = text;
	try {
		const body = JSON.parse(text) as { error?: unknown };
		if (typeof body.error === "string") {
			message = body.error;
		}
	} catch {
		// Not JSON.
	}
	switch (status) {
		case 426:
			return new TunnelError("upgrade_required", message);
		case 429:
			return new TunnelError("rate_limited", message);
		case 401:
			return new TunnelError("unauthorized", message);
		case 404:
		case 410:
			return new TunnelError("tunnel_gone", message);
		default:
			return new TunnelError("server_error", `Server responded ${status}: ${message}`);
	}
}
