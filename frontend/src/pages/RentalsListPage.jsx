import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Text,
  Title,
  Button,
  Tag,
  Input,
  Table,
  Spinner,
  Alert,
  Thumbnail,
  Pagination,
} from '@nimbus-ds/components';
import api from '../services/api.js';
import { RENTAL_STATUS_MAP } from '../lib/rentalStatus.js';
import { formatDisplayDate } from '../lib/dateDisplay.js';

const PAGE_SIZE = 20;

export default function RentalsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [rentals, setRentals] = useState([]);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(''); // valor digitado (imediato)
  const [search, setSearch] = useState(''); // valor efetivamente buscado (debounced)
  const [sortAsc, setSortAsc] = useState(true);

  // Busca é feita no servidor — sem isso, com paginação real, ela só encontraria
  // produtos dentro da página atualmente carregada.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (pageArg, searchArg) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/rentals', {
        params: { criterio: 2, page: pageArg, pageSize: PAGE_SIZE, search: searchArg || undefined },
      });
      setRentals(data.rentals || []);
      setPageCount(data.pageCount || 1);
    } catch {
      setError(t('rentals.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(page, search); }, [load, page, search]);

  // Ordena só a página atual (sort global exigiria ordenação no servidor) —
  // aceitável, a ordem de fetch já é por data e é a página inteira visível.
  const visible = useMemo(() => {
    return [...rentals].sort((a, b) => {
      const cmp = (a.productName || '').localeCompare(b.productName || '');
      return sortAsc ? cmp : -cmp;
    });
  }, [rentals, sortAsc]);

  return (
    <Box display="flex" flexDirection="column" gap="4">

      {/* Breadcrumb */}
      <Box display="flex" alignItems="center" gap="1">
        <Text as="span" color="primary-interactive" cursor="pointer" onClick={() => navigate('/produtos')}>
          {t('products.title')}
        </Text>
        <Text as="span" color="neutral-textDisabled"> / </Text>
        <Text as="span" color="neutral-textLow">{t('rentals.title')}</Text>
      </Box>

      {/* Cabeçalho */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="3">
        <Title as="h2">{t('products.heading')}</Title>
        <Box display="flex" gap="2">
          <Button appearance="primary" onClick={() => navigate('/alugueis/fluxo')}>
            {t('rentals.fluxoBtn')}
          </Button>
          <Button appearance="neutral" onClick={() => navigate('/produtos')}>
            {t('products.title')}
          </Button>
        </Box>
      </Box>

      {/* Busca */}
      <Box style={{ maxWidth: 360 }}>
        <Input
          placeholder={t('rentals.searchPlaceholder')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </Box>

      {error && (
        <Alert appearance="danger">
          <Text>{error}</Text>
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" padding="8">
          <Spinner size="large" />
        </Box>
      ) : visible.length === 0 ? (
        <Box
          padding="8"
          display="flex"
          justifyContent="center"
          borderColor="neutral-surfaceHighlight"
          borderStyle="dashed"
          borderWidth="1"
          borderRadius="2"
        >
          <Text color="neutral-textLow">{t('rentals.listEmpty')}</Text>
        </Box>
      ) : (
        <Box style={{ overflowX: 'auto' }}>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Cell as="th">
                  <Text
                    as="span"
                    cursor="pointer"
                    fontWeight="bold"
                    onClick={() => setSortAsc((v) => !v)}
                  >
                    {t('rentals.colProduct')} {sortAsc ? '▲' : '▼'}
                  </Text>
                </Table.Cell>
                <Table.Cell as="th">{t('rentals.colStatus')}</Table.Cell>
                <Table.Cell as="th">{t('rentals.colQuantity')}</Table.Cell>
                <Table.Cell as="th">{t('rentals.colEventDate')}</Table.Cell>
                <Table.Cell as="th">{t('rentals.colPeriod')}</Table.Cell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {visible.map((r) => {
                const statusMeta = RENTAL_STATUS_MAP.get(r.status);
                return (
                  <Table.Row key={r.id}>
                    <Table.Cell>
                      <Box display="flex" gap="3" alignItems="center">
                        {r.productImage ? (
                          <Thumbnail src={r.productImage} alt={r.productName} width="48px" aspectRatio="1/1" />
                        ) : (
                          <Box
                            width="48px"
                            backgroundColor="neutral-surfaceHighlight"
                            borderRadius="2"
                            style={{ height: 48, flexShrink: 0 }}
                          />
                        )}
                        <Text fontWeight="bold">{r.productName}</Text>
                      </Box>
                    </Table.Cell>
                    <Table.Cell>
                      <Tag appearance={statusMeta?.appearance || 'neutral'}>
                        {statusMeta ? t(statusMeta.labelKey) : r.status}
                      </Tag>
                    </Table.Cell>
                    <Table.Cell>
                      <Text>{r.quantity}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text>{formatDisplayDate(r.eventDate)}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Box display="flex" flexDirection="column" gap="1">
                        <Text fontSize="caption">
                          {t('rentals.periodStart')}: {formatDisplayDate(r.reservationStart)}
                        </Text>
                        <Text fontSize="caption">
                          {t('rentals.periodEnd')}: {formatDisplayDate(r.reservationEnd)}
                        </Text>
                      </Box>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </Box>
      )}

      {!loading && pageCount > 1 && (
        <Box display="flex" justifyContent="center">
          <Pagination activePage={page} pageCount={pageCount} onPageChange={setPage} />
        </Box>
      )}

    </Box>
  );
}
