import "server-only";
import { getJob, subscribe } from "@/lib/jobs";

export const runtime = "nodejs";

// Server-Sent Events stream of an ingest job's log lines and final status.
// Clients connect via EventSource("/api/ingest/<id>/stream").
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) {
    return new Response("job not found", { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: string, event?: string) => {
        const prefix = event ? `event: ${event}\n` : "";
        controller.enqueue(enc.encode(`${prefix}data: ${data}\n\n`));
      };

      // Replay the existing log so reconnects pick up where they left off.
      for (const line of job.log) {
        send(JSON.stringify(line));
      }

      if (job.status === "done" || job.status === "error") {
        send(
          JSON.stringify({ status: job.status, exitCode: job.exitCode }),
          "done",
        );
        controller.close();
        return;
      }

      // Heartbeat so proxies don't time out an idle connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: keep-alive\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      const unsub = subscribe(jobId, (line, status) => {
        try {
          if (line) send(JSON.stringify(line));
          if (status === "done" || status === "error") {
            const j = getJob(jobId);
            send(
              JSON.stringify({
                status,
                exitCode: j?.exitCode,
              }),
              "done",
            );
            controller.close();
            clearInterval(heartbeat);
            unsub();
          }
        } catch {
          // controller closed by client disconnect
          clearInterval(heartbeat);
          unsub();
        }
      });
    },
    cancel() {
      // EventSource closed by client. Subscriber cleans itself up via the
      // controller-closed catch above.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
