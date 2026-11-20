# EchoVault — Как да използваш този пакет

1. Прочети `EchoVault_Project_Blueprint.md` — основната техническа спецификация, екрани, схема, RLS, Storage, acceptance и roadmap.
2. Копирай `.github/copilot-instructions.md` в GitHub репото на проекта, на същия път. Това задава правилата на AI агента.
3. Ползвай `EchoVault_Copilot_Prompts.md` като последователни задачи: **един prompt → преглед → тест → commit**.
4. Използвай `.env.example` за локалните публични Supabase параметри; secret/service-role keys не се публикуват.
5. Важна граница: това е **Blueprint и prompt kit, не работещо приложение**. SQL фрагментите в Blueprint са примери; преди deployment трябва да се генерират, приложат и тестват действителните Supabase migrations/RLS policies.

Минималният ред, ако времето е ограничено: setup → 5+ страници → Supabase schema → Auth → Storage upload/download → Admin/RLS → deployment/README; после audio effects и Marketplace.
