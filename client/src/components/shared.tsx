import type { BoardTech, DayLocation, Island } from '../types';
import { LEVEL_LABEL } from '../types';
import { useData } from '../ui';

export interface DropTarget {
  techId: number | null;
  date: string;
  /** Minutes after midnight; omitted = keep the job's current time of day. */
  minutes?: number;
}

export function dayStateLabel(
  loc: DayLocation,
  islandId: number,
  islandById: (id: number) => Island | undefined,
): string {
  if (loc.islandId !== islandId) return `✈ On ${islandById(loc.islandId)?.name ?? 'another island'}`;
  if (loc.status === 'off') return '🌴 Off';
  return '';
}

export function TechLabel({ tech, loc, islandId }: { tech: BoardTech; loc?: DayLocation; islandId: number }) {
  const { islandById, skillById } = useData();
  const visiting = tech.home_island_id !== islandId;
  const skillText = tech.skills
    .map((s) => `${skillById(s.skill_id)?.name ?? '?'} (${LEVEL_LABEL[s.level]})`)
    .join('\n');
  return (
    <div className="tech-label" title={`${tech.name}\n${tech.phone}\n\nSkills:\n${skillText || 'none'}`}>
      <span className="avatar" style={{ background: tech.color }}>
        {tech.name
          .split(' ')
          .map((p) => p[0])
          .join('')
          .slice(0, 2)}
      </span>
      <span className="tech-label-text">
        <span className="tech-name">{tech.name}</span>
        <span className="tech-sub">
          {visiting && (
            <span className="tag tag-travel" title={`Home island: ${islandById(tech.home_island_id)?.name}`}>
              ✈ from {islandById(tech.home_island_id)?.code || islandById(tech.home_island_id)?.name}
            </span>
          )}
          {loc?.status === 'off' && loc.islandId === islandId && <span className="tag tag-off">Off</span>}
          <span className="tech-skill-count">{tech.skills.length} skills</span>
        </span>
      </span>
    </div>
  );
}
