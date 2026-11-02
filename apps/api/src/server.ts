import { createKarenPayApi } from "./index.js";

const app = createKarenPayApi();
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`KarenPay API listening on port ${port}`);
  });
}

export default app;
