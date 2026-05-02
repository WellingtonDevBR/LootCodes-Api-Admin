export interface IIpBlocklist {
  isBlocked(ipAddress: string): Promise<boolean>;
}
