import { io, type Socket } from "socket.io-client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:4000";

export type AdminSnapshot = {
  election: null | {
    id: string;
    start_time: string;
    end_time: string;
    is_active: boolean;
  };
  voterTotal: number;
  votesTotal: number;
  turnout: number;
  candidates: Array<{
    id: string;
    name: string;
    party: string;
    vote_count_total: number;
    vote_count_in_window: number;
  }>;
};

export function connectAdminSocket(token: string): Socket {
  // Ensure we create a new connection per token in case user logs out/in.
  return io(API_BASE, {
    autoConnect: true,
    auth: { token },
    transports: ["websocket"],
  });
}

