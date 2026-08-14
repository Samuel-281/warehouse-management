-- Merged outbound groups are presented as ordinary outbound documents.
UPDATE "tracking_order_groups"
SET "groupNo" = CASE
  WHEN "type" = 'TRANSFER' THEN 'ZC' || SUBSTRING("groupNo" FROM 3)
  ELSE 'ZX' || SUBSTRING("groupNo" FROM 3)
END
WHERE "groupNo" LIKE 'HD%';

-- Keep the original order relation for internal audit, but expose the merged
-- document number consistently in barcode movement history.
UPDATE "tracking_movements" AS movement
SET "groupId" = member."groupId",
    "groupNo" = merged."groupNo"
FROM "tracking_order_group_members" AS member
JOIN "tracking_order_groups" AS merged ON merged."id" = member."groupId"
WHERE movement."orderId" = member."orderId"
  AND (
    movement."groupId" IS DISTINCT FROM member."groupId"
    OR movement."groupNo" IS DISTINCT FROM merged."groupNo"
  );
