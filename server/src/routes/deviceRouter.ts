import { FastifyPluginAsync } from "fastify";
import Expo from "expo-server-sdk";
import { z } from "zod";
import { registerDevice, getDevicePushTokens } from "../db/alertsDb";

const API_KEY = process.env.API_KEY ?? "change_me";

const RegisterBody = z.object({
  push_token:     z.string().min(1),
  wallet_address: z.string().optional(),
});

const deviceRouter: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /device/register
   * Mobile app calls this on startup to store its Expo push token.
   * Server uses it to send background notifications when the app is closed.
   */
  fastify.post("/device/register", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { push_token, wallet_address } = parsed.data;

    if (!Expo.isExpoPushToken(push_token)) {
      return reply.code(400).send({ error: "Invalid Expo push token format" });
    }

    await registerDevice(push_token, wallet_address);
    return reply.code(201).send({ ok: true });
  });

  fastify.get("/device/tokens", async (req, reply) => {
    if (req.headers["x-api-key"] !== API_KEY) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const tokens = await getDevicePushTokens();
    return reply.send({ count: tokens.length, tokens });
  });
};

export default deviceRouter;
