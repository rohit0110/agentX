import Expo, { ExpoPushTicket } from "expo-server-sdk";
import { getDevicePushTokens } from "../db/alertsDb";

const expo = new Expo();

export async function sendPushToDevices(
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const tokens = await getDevicePushTokens();

  if (tokens.length === 0) {
    console.log("[expoPush] No registered device tokens — skipping push");
    return;
  }

  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (valid.length === 0) {
    console.warn("[expoPush] Tokens found but none are valid Expo push tokens:", tokens);
    return;
  }

  const messages = valid.map((to) => ({
    to,
    sound: "default" as const,
    title,
    body,
    data,
  }));

  console.log(`[expoPush] Sending to ${valid.length} device(s): "${title}"`);

  try {
    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }

    // Log every ticket so errors are visible
    tickets.forEach((ticket, i) => {
      if (ticket.status === "ok") {
        console.log(`[expoPush] ticket[${i}] ok — id: ${ticket.id}`);
      } else {
        console.error(
          `[expoPush] ticket[${i}] error — ${ticket.message} (${ticket.details?.error ?? "no detail"})`
        );
      }
    });
  } catch (err) {
    console.error("[expoPush] Fatal error sending push:", err);
  }
}
