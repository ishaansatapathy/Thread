/**
 * OpenTelemetry SDK bootstrap.
 *
 * Must be imported BEFORE any other module in the entry-point (index.ts) so
 * that auto-instrumentation patches HTTP/Express/PG before they load.
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is set the SDK ships traces to your
 * collector (e.g. Jaeger, Tempo, Honeycomb).  Without it the SDK is still
 * initialised so spans exist in-process — the console exporter prints them
 * when OTEL_LOG_LEVEL=debug.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

let sdk: NodeSDK | undefined;

export function initTracing() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const serviceName = process.env.OTEL_SERVICE_NAME ?? "thread-api";

  sdk = new NodeSDK({
    serviceName,
    traceExporter: endpoint
      ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Reduce noise — skip fs, dns, net auto-instrumentation in dev.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on("SIGTERM", async () => {
    await sdk?.shutdown();
  });

  if (endpoint) {
    console.log(`[otel] Tracing → ${endpoint} (service: ${serviceName})`);
  } else {
    console.log("[otel] Tracing initialised (no OTEL_EXPORTER_OTLP_ENDPOINT — in-process only)");
  }
}
