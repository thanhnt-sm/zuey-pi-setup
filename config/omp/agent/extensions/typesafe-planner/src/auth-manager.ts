import * as crypto from "crypto";
import type { AuthState } from "./types/security";

export class AuthManager {
  private lastFailedKeyHash?: string;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 1;

  public hashToken(token: string): string {
    if (!token) return "";
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return hash.substring(0, 16);
  }

  public canAttempt(token: string): boolean {
    const hash = this.hashToken(token);
    
    if (this.lastFailedKeyHash && this.lastFailedKeyHash !== hash) {
      this.reset();
      return true;
    }
    
    return this.retryCount < this.MAX_RETRIES;
  }

  public recordFailure(token: string, status: number): void {
    if (status === 401 || status === 403) {
      this.lastFailedKeyHash = this.hashToken(token);
      this.retryCount++;
    }
  }

  public recordSuccess(token: string): void {
    const hash = this.hashToken(token);
    if (this.lastFailedKeyHash === hash) {
      this.reset();
    }
  }

  public reset(): void {
    this.lastFailedKeyHash = undefined;
    this.retryCount = 0;
  }

  public getState(token: string): AuthState {
    const hash = this.hashToken(token);
    
    if (this.lastFailedKeyHash === hash && this.retryCount >= this.MAX_RETRIES) {
      return { status: "revoked", tokenHash: hash, retryCount: this.retryCount };
    }
    
    return { 
      status: this.lastFailedKeyHash === hash ? "refreshing" : "authenticated", 
      tokenHash: hash, 
      retryCount: this.retryCount 
    };
  }
}
