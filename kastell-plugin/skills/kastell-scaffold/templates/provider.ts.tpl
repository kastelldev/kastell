import {
  BaseProvider,
  type ProviderServer,
  type CreateServerParams,
  type ProviderResponse,
} from "./base.js";

export class __NAME_PASCAL__Provider extends BaseProvider {
  constructor(token: string) {
    super(token, "https://api.__NAME__.com/v1"); // TODO: adjust API base URL
  }

  async listServers(): Promise<ProviderResponse<ProviderServer[]>> {
    return this.request<ProviderServer[]>("GET", "/servers");
  }

  async createServer(
    params: CreateServerParams,
  ): Promise<ProviderResponse<ProviderServer>> {
    return this.request<ProviderServer>("POST", "/servers", { body: params });
  }

  async deleteServer(serverId: string): Promise<ProviderResponse<void>> {
    return this.request<void>("DELETE", `/servers/${serverId}`);
  }

  async getServer(
    serverId: string,
  ): Promise<ProviderResponse<ProviderServer>> {
    return this.request<ProviderServer>("GET", `/servers/${serverId}`);
  }
}
