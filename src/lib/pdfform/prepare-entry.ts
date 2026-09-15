/**
 * What scripts/embed-forms.mjs bundles and runs: the two preparation steps
 * with the site's own data already bound. Kept apart from prepare.ts so
 * that file stays free of data imports and the browser bundle stays small.
 */
import { CEREMONY } from '../data/ceremony';
import { BODY_FAT_TABLES } from '../data/pt';
import { promotionEngineSource } from './promotion-form';
import { preparePromotionBuilder, preparePtCalculator } from './prepare';

export async function preparePt(bytes: Uint8Array): Promise<Uint8Array> {
  return preparePtCalculator(bytes, BODY_FAT_TABLES.data);
}

export async function preparePromotion(bytes: Uint8Array): Promise<Uint8Array> {
  return preparePromotionBuilder(bytes, promotionEngineSource(CEREMONY.data));
}
