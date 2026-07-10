export const MAX_BARCODE_BATCH = 500;

export function assertBarcodeBatchLimit(barcodes: string[]) {
  if (barcodes.length > MAX_BARCODE_BATCH) {
    throw new Error(`单次最多处理 ${MAX_BARCODE_BATCH} 个条码，请分批提交`);
  }
}
