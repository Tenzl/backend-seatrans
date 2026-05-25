import type { PortArea } from './list-ports-query.dto';

export interface ListPortsFilters {
  area?: PortArea;
  provinceId?: number;
  activeOnly?: boolean;
  limit?: number;
}
