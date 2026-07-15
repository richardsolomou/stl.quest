ALTER TABLE requests ADD COLUMN print_type TEXT CHECK (print_type IN ('resin', 'filament'));

UPDATE requests SET print_type='resin' WHERE printer_id IS NULL;

UPDATE settings
SET value_json = (
  SELECT json_group_array(
    json_remove(
      json_set(value, '$.printType', CASE json_extract(value, '$.technology') WHEN 'fdm' THEN 'filament' ELSE 'resin' END),
      '$.technology'
    )
  )
  FROM json_each(settings.value_json)
)
WHERE key='plate-planner-profiles';

CREATE INDEX requests_print_type ON requests(print_type);
CREATE INDEX requests_printer_id ON requests(printer_id);
