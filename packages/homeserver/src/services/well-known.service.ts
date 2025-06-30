import { ConfigService } from "./config.service";
import { injectable } from "tsyringe";

@injectable()
export class WellKnownService {
  constructor(private readonly configService: ConfigService) {}

  getWellKnownHostData() {
    const hasTlsPort = this.configService.getServerConfig().port === 443;
    return {
      "m.server": `${this.configService.getServerConfig().name}${
        hasTlsPort ? "" : `:${this.configService.getServerConfig().port}`
      }`,
    };
  }
}
