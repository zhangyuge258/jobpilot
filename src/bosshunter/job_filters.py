"""Shared job filtering helpers."""

import re
import math

CITY_SEPARATOR = "·"


def city_base_name(city: str) -> str:
	"""Return the city part of a platform label such as 上海·浦东新区."""
	return str(city or "").strip().split(CITY_SEPARATOR)[0].strip()


def city_match_clause(cities: list[str]) -> tuple[str, list[str]]:
	"""Build a SQL condition matching whole cities, district-suffixed labels included."""
	clauses: list[str] = []
	params: list[str] = []
	for city in cities:
		base = city_base_name(city)
		if not base:
			continue
		clauses.append("TRIM(COALESCE(city, '')) = ? OR TRIM(COALESCE(city, '')) LIKE ?")
		params.extend([base, f"{base}{CITY_SEPARATOR}%"])
	return f"({' OR '.join(clauses)})", params


def matching_deal_breaker(text: str, deal_breakers: list[str]) -> str | None:
    """Return the first deal-breaker keyword found in text."""
    text_lower = text.lower()
    for keyword in deal_breakers:
        cleaned_keyword = keyword.strip()
        if cleaned_keyword and cleaned_keyword.lower() in text_lower:
            return keyword
    return None


def column_filter_clauses(filters: dict) -> tuple[list[str], list]:
    """Literal column text filters, combined with all other filters before paging."""
    clauses, params = [], []
    for column in ('company', 'title', 'hr_active'):
        value = str(filters.get(column) or '').strip()
        if not value:
            continue
        if column == 'hr_active' and value in {'unknown', '未知', '活跃度未知'}:
            clauses.append("(TRIM(COALESCE(hr_active,''))='' OR instr(hr_active,'未知')>0)")
        else:
            clauses.append(f"instr(lower(COALESCE({column},'')),lower(?))>0")
            params.append(value)
    titles = filters.get('titles') or []
    if isinstance(titles, str):
        titles = [titles]
    if not isinstance(titles, list) or any(not isinstance(value, str) for value in titles):
        raise ValueError('职位筛选必须是职位名称列表')
    titles = list(dict.fromkeys(value.strip() for value in titles if value.strip()))
    if titles:
        clauses.append(f"TRIM(COALESCE(title,'')) IN ({','.join('?' for _ in titles)})")
        params.extend(titles)
    maximum = filters.get('max_score')
    if maximum not in (None, ''):
        try:
            maximum = float(maximum)
        except (ValueError, TypeError) as exc:
            raise ValueError('最高评分必须是 0 至 100 的数字') from exc
        if not math.isfinite(maximum) or not 0 <= maximum <= 100:
            raise ValueError('最高评分必须是 0 至 100 的数字')
        minimum = filters.get('min_score')
        if minimum not in (None, '') and float(minimum) > maximum:
            raise ValueError('最低评分不能高于最高评分')
        clauses.append('COALESCE(score,0)<=?')
        params.append(maximum)
    return clauses, params


def matching_blocked_company(company: str, blocked_companies: list[str]) -> str | None:
    """Return the first blocked-company rule contained in a company name."""
    company_lower = str(company or "").strip().lower()
    for rule in blocked_companies or []:
        cleaned_rule = str(rule or "").strip()
        if cleaned_rule and cleaned_rule.lower() in company_lower:
            return cleaned_rule
    return None


def parse_monthly_salary_k(salary: str) -> tuple[float, float] | None:
    """Convert platform monthly salary labels (K, 万, 千, 元) to K."""
    normalized = str(salary or "").strip().replace(',', '')
    if re.search(r'[/／]\s*(?:天|日|小时|时|周|年)|(?:日薪|时薪|周薪|年薪)', normalized):
        return None
    range_match = re.search(
        r"(\d+(?:\.\d+)?)\s*([kK万千元]?)\s*[-—–~至]\s*(\d+(?:\.\d+)?)\s*([kK万千元])",
        normalized,
    )
    scales = {'k': 1, '万': 10, '千': 1, '元': .001}
    if range_match:
        low, low_unit, high, high_unit = range_match.groups()
        low = float(low) * scales[(low_unit or high_unit).lower()]
        high = float(high) * scales[high_unit.lower()]
        return (min(low, high), max(low, high))

    single_match = re.search(r"(\d+(?:\.\d+)?)\s*([kK万千元])", normalized)
    if single_match:
        value = float(single_match.group(1)) * scales[single_match.group(2).lower()]
        return value, value
    return None
