import { z } from "zod";
export const PersonInput = z.object({ email: z.string().email().max(200), name: z.string().max(100) });
