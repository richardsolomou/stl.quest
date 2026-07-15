UPDATE settings
SET value_json = (
  SELECT json_group_array(
    json_remove(
      json_set(
        value,
        '$.printType',
        CASE
          WHEN json_extract(value, '$.printType') IN ('resin', 'filament') THEN json_extract(value, '$.printType')
          WHEN json_extract(value, '$.technology') = 'fdm' THEN 'filament'
          ELSE 'resin'
        END
      ),
      '$.technology'
    )
  )
  FROM json_each(settings.value_json)
)
WHERE key='plate-planner-profiles';

CREATE INDEX IF NOT EXISTS requests_print_type ON requests(print_type);
CREATE INDEX IF NOT EXISTS requests_printer_id ON requests(printer_id);
