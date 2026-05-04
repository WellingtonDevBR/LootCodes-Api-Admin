import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { GetScreenshotUrlResult } from './price-match.types.js';

@injectable()
export class GetPriceMatchScreenshotUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(screenshotPath: string): Promise<GetScreenshotUrlResult> {
    return this.repo.getScreenshotUrl(screenshotPath);
  }
}
