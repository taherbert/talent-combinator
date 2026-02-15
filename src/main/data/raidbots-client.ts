import { net } from "electron";
import { RAIDBOTS_TALENT_URL } from "../../shared/constants";
import type { RawSpecData } from "../../shared/types";

export async function fetchTalentJSON(): Promise<RawSpecData[]> {
  return new Promise((resolve, reject) => {
    const request = net.request(RAIDBOTS_TALENT_URL);

    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Raidbots returned ${response.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          const json = Buffer.concat(chunks).toString("utf-8");
          const data = JSON.parse(json) as RawSpecData[];
          resolve(data);
        } catch (e) {
          reject(new Error(`Failed to parse talent JSON: ${e}`));
        }
      });
      response.on("error", reject);
    });

    request.on("error", reject);
    request.end();
  });
}
