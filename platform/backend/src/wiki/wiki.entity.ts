import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity('wiki_pages')
export class WikiPage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'parent_id', nullable: true }) parentId?: string;
  @Column() title: string;
  @Column({ type: 'text', default: '' }) content: string;
  @Column({ default: 'page' }) kind: 'page' | 'folder';
  @Column({ default: 'draft' }) status: 'draft' | 'published' | 'archived';
  @Column({ name: 'dataset_id', default: '' }) datasetId: string;
  @Column({ name: 'sec_level', default: 1 }) secLevel: number;
  @Column({ default: 0 }) revision: number;
  @Column({ name: 'published_revision', nullable: true }) publishedRevision?: number;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
@Entity('wiki_versions')
@Unique(['pageId', 'revision'])
export class WikiVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'page_id' }) pageId: string;
  @Column() revision: number;
  @Column() title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
}
