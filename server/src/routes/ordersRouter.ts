import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAlert, getAlerts, cancelAlert } from "../db/alertsDb";

const API_KEY = process.env.API_KEY ?? "change_me";

function authCheck(key: string | undefined): boolean {
  return key === API_KEY;
}

const CreateAlertBody = z.object({
  token: z.string().toUpperCase(),
  target_price: z.number().positive(),
  direction: z.enum(["above", "below"]),
  from_token: z.string().toUpperCase(),
  to_token: z.string().toUpperCase(),
  amount: z.number().positive(),
  session_id: z.string().optional(),
});

const ordersRouter: FastifyPluginAsync = async (fastify) => {
  // POST /orders/alert — create a price alert
  fastify.post("/orders/alert", async (req, reply) => {
    if (!authCheck(req.headers["x-api-key"] as string | undefined)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = CreateAlertBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const alert = await createAlert(parsed.data);

    return reply.code(201).send({
      alert_id: Number(alert.id),
      token: alert.token,
      target_price: Number(alert.target_price),
      direction: alert.direction,
      from_token: alert.from_token,
      to_token: alert.to_token,
      amount: Number(alert.amount),
      status: alert.status,
      created_at: alert.created_at,
    });
  });

  // GET /orders/alerts — list all alerts (optionally filter by status)
  fastify.get("/orders/alerts", async (req, reply) => {
    if (!authCheck(req.headers["x-api-key"] as string | undefined)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { status } = (req.query as { status?: string });
    const alerts = await getAlerts(status);

    return reply.send(
      alerts.map((a) => ({
        alert_id: Number(a.id),
        session_id: a.session_id,
        token: a.token,
        target_price: Number(a.target_price),
        direction: a.direction,
        from_token: a.from_token,
        to_token: a.to_token,
        amount: Number(a.amount),
        status: a.status,
        created_at: a.created_at,
      }))
    );
  });

  // DELETE /orders/alerts/:id — cancel an active alert
  fastify.delete("/orders/alerts/:id", async (req, reply) => {
    if (!authCheck(req.headers["x-api-key"] as string | undefined)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    const cancelled = await cancelAlert(id);

    if (!cancelled) {
      return reply.code(404).send({ error: "Alert not found or already inactive" });
    }

    return reply.send({ ok: true, alert_id: Number(id) });
  });
};

export default ordersRouter;
