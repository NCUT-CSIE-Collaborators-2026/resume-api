SELECT json_group_object(lang_code, json(payload)) AS content
FROM resume_i18n_content;
