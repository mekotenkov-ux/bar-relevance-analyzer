import styles from "./license.module.css";
import { PRODUCT_ATTRIBUTION } from "@/lib/attribution";
import Image from "next/image";

export default function LicensePage() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href={PRODUCT_ATTRIBUTION.schoolUrl} target="_blank" rel="noreferrer">
        <Image src="/seomeat-logo.svg" alt="SEO Мясо" width={152} height={16} />
        <span><b>SEO Мясо</b><small>{PRODUCT_ATTRIBUTION.productName}</small></span>
      </a>
      <a className={styles.back} href="/analyzer">Вернуться к анализатору →</a>
    </header>

    <article className={styles.document}>
      <span className={styles.eyebrow}>Лицензия и авторство</span>
      <h1>Можно дорабатывать, перерабатывать и распространять.</h1>
      <p className={styles.lead}>БАР распространяется по стандартной лицензии MIT. Она разрешает свободно менять продукт под себя, включая название, дизайн, код и коммерческую модель.</p>

      <section className={styles.grid}>
        <div><span>Оригинальный автор</span><strong>{PRODUCT_ATTRIBUTION.author}</strong></div>
        <div><span>Проект</span><strong>{PRODUCT_ATTRIBUTION.brand}</strong></div>
        <div><span>Лицензия</span><code>{PRODUCT_ATTRIBUTION.license}</code></div>
      </section>

      <section>
        <h2>Разрешено</h2>
        <ul><li>использовать инструмент лично и в компании;</li><li>дорабатывать, переписывать и объединять с другими продуктами;</li><li>менять название, логотип, интерфейс, ссылки и технологии;</li><li>распространять, продавать и сублицензировать исходную или изменённую версию;</li><li>предоставлять сервис через интернет или сохранять доработки закрытыми.</li></ul>
      </section>

      <section>
        <h2>Единственное обязательное условие</h2>
        <ul><li>включать copyright и текст разрешения из файла LICENSE во все копии или существенные части программы;</li><li>не удалять из этого уведомления указание на SEO Мясо и Максима Котенкова как источник оригинального проекта;</li><li>свободно добавлять собственное авторство на сделанные вами изменения.</li></ul>
      </section>

      <aside className={styles.notice}><strong>Никаких скрытых ограничений.</strong><p>Нет обязательных логотипов, названий, ссылок в шапке, служебных идентификаторов, водяных знаков или запрета на ребрендинг. Юридически значимое условие находится в файле LICENSE.</p></aside>

      <div className={styles.links}>
        <a href={PRODUCT_ATTRIBUTION.schoolUrl} target="_blank" rel="noreferrer">Сайт школы SEO Мясо</a>
        <a href={PRODUCT_ATTRIBUTION.telegramUrl} target="_blank" rel="noreferrer">Telegram Максима Котенкова</a>
      </div>
      <p className={styles.disclaimer}>MIT — стандартная разрешительная лицензия. Эта страница объясняет её простыми словами; при расхождениях применяется английский текст файла LICENSE.</p>
    </article>
  </main>;
}
