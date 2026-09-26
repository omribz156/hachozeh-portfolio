export const INCIDENT_COMPENSATION_LATERAL_JOIN = `
      left join lateral (
        select coalesce(sum(le.amount), 0) as compensation_amount
        from ledger_transactions lt
        join ledger_entries le
          on le.transaction_id = lt.id
         and le.entry_role = 'credit_user_cash_incident_compensation'
        where lt.reference_type = 'market_incident_compensation'
          and lt.reference_id = 'market_incident_compensation:' || re.market_id || ':' || re.id
      ) incident_comp on true
`;

export const EFFECTIVE_REALIZATION_TYPE_SQL = `
        case
          when re.type in ('resolution_win', 'resolution_loss')
           and mr.winning_outcome_id is not null
            then case
              when re.outcome_id = mr.winning_outcome_id then 'resolution_win'
              else 'resolution_loss'
            end
          when re.type = 'resolution_loss'
           and coalesce(incident_comp.compensation_amount, 0) > 0 then 'resolution_win'
          else re.type
        end
`;

export const EFFECTIVE_PROCEEDS_SQL = `
        case
          when re.type in ('resolution_win', 'resolution_loss')
           and mr.winning_outcome_id is not null
            then case
              when re.outcome_id = mr.winning_outcome_id
                then re.proceeds + coalesce(incident_comp.compensation_amount, 0)
              else 0
            end
          else re.proceeds + coalesce(incident_comp.compensation_amount, 0)
        end
`;

export const EFFECTIVE_REALIZED_PNL_SQL = `
        case
          when re.type in ('resolution_win', 'resolution_loss')
           and mr.winning_outcome_id is not null
            then (${EFFECTIVE_PROCEEDS_SQL}) - re.removed_cost_basis
          else re.realized_pnl + coalesce(incident_comp.compensation_amount, 0)
        end
`;
