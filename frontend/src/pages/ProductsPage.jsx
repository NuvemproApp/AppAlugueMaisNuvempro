import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Text,
  Title,
  Button,
  Tag,
  Modal,
  Table,
  Select,
  Input,
  Toggle,
  Spinner,
  Alert,
  Thumbnail,
  Pagination,
} from '@nimbus-ds/components';
import api from '../services/api.js';

const PAGE_SIZE = 20;

function SortableHeader({ label, field, sortBy, sortDir, onSort }) {
  const active = sortBy === field;
  return (
    <Text
      as="span"
      cursor="pointer"
      fontWeight="bold"
      onClick={() => onSort(field)}
    >
      {label} {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </Text>
  );
}

// ─── Dropdown de ações ────────────────────────────────────────────────────────
function ActionsMenu({ onEdit, onDelete, labelEdit, labelDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return; // só ouve clique fora enquanto o menu está de fato aberto
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <Box ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <Button size="small" appearance="neutral" onClick={() => setOpen((v) => !v)}>
        {labelDelete ? '•••' : 'Ações'} ▾
      </Button>
      {open && (
        <Box
          backgroundColor="neutral-background"
          borderColor="neutral-surfaceHighlight"
          borderStyle="solid"
          borderWidth="1"
          borderRadius="2"
          style={{
            position: 'absolute',
            right: 0,
            top: '110%',
            zIndex: 50,
            minWidth: 130,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          <Box display="flex" flexDirection="column" padding="1" gap="1">
            <Button
              appearance="transparent"
              size="small"
              onClick={() => { onEdit(); setOpen(false); }}
            >
              {labelEdit}
            </Button>
            <Button
              appearance="transparent"
              size="small"
              onClick={() => { onDelete(); setOpen(false); }}
            >
              <Text color="danger-interactive">{labelDelete}</Text>
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─── Formulário dentro do modal ───────────────────────────────────────────────
const EMPTY_FORM = {
  productId: '',
  status: 1,
  diasAntes: 0,
  diasDepois: 0,
  estoque: 1,
};

export default function ProductsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState(''); // valor digitado (imediato)
  const [search, setSearch] = useState(''); // valor efetivamente buscado (debounced)
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = criando, objeto = editando
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [invalidFields, setInvalidFields] = useState(new Set());
  const [validationErrors, setValidationErrors] = useState([]);

  const [nsProducts, setNsProducts] = useState([]); // produtos NS disponíveis para o select
  const [nsLoading, setNsLoading] = useState(false);

  // Busca é feita no servidor — com paginação real, filtrar só o que já está
  // carregado na tela deixaria de encontrar produtos nas outras páginas.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ─── Carrega lista de produtos alugáveis ──────────────────────────────────
  const loadProducts = useCallback(async (pageArg, searchArg, sortByArg, sortDirArg) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/products', {
        params: { page: pageArg, pageSize: PAGE_SIZE, search: searchArg || undefined, sortBy: sortByArg, sortDir: sortDirArg },
      });
      setProducts(data.products || []);
      setTotal(data.total || 0);
      setPageCount(data.pageCount || 1);
    } catch {
      setError(t('products.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadProducts(page, search, sortBy, sortDir);
  }, [loadProducts, page, search, sortBy, sortDir]);

  function handleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  }

  // ─── Abre modal de criação ────────────────────────────────────────────────
  async function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setInvalidFields(new Set());
    setValidationErrors([]);
    setModalOpen(true);
    setNsLoading(true);
    try {
      const { data } = await api.get('/api/products/nuvemshop');
      setNsProducts(data.products || []);
    } catch {
      setNsProducts([]);
    } finally {
      setNsLoading(false);
    }
  }

  // ─── Abre modal de edição ─────────────────────────────────────────────────
  function openEdit(product) {
    setEditing(product);
    setForm({
      productId: product.productId,
      status: product.status,
      diasAntes: product.diasAntes,
      diasDepois: product.diasDepois,
      estoque: product.estoque,
    });
    setInvalidFields(new Set());
    setValidationErrors([]);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setInvalidFields(new Set());
    setValidationErrors([]);
  }

  // ─── Limpa o estado de inválido de um campo ao ser editado ────────────────
  function clearInvalid(field) {
    setInvalidFields((s) => {
      if (!s.has(field)) return s;
      const next = new Set(s);
      next.delete(field);
      return next;
    });
  }

  // ─── Valida os campos do formulário (inteiros, obrigatórios) ──────────────
  function validate() {
    const invalid = new Set();
    const errors = [];

    if (!editing && !form.productId) {
      invalid.add('productId');
      errors.push(t('products.errorNoProduct'));
    }
    if (!Number.isInteger(form.estoque) || form.estoque < 1) {
      invalid.add('estoque');
      errors.push(t('products.errorStock'));
    }
    if (!Number.isInteger(form.diasAntes) || form.diasAntes < 0) {
      invalid.add('diasAntes');
      errors.push(t('products.errorDaysBefore'));
    }
    if (!Number.isInteger(form.diasDepois) || form.diasDepois < 0) {
      invalid.add('diasDepois');
      errors.push(t('products.errorDaysAfter'));
    }

    return { invalid, errors };
  }

  // ─── Salva (criar ou atualizar) ───────────────────────────────────────────
  async function handleSave() {
    const { invalid, errors } = validate();
    if (errors.length > 0) {
      setInvalidFields(invalid);
      setValidationErrors(errors);
      return;
    }

    setSaving(true);
    setInvalidFields(new Set());
    setValidationErrors([]);
    try {
      if (editing) {
        await api.patch(`/api/products/${editing.id}`, {
          status: form.status,
          diasAntes: form.diasAntes,
          diasDepois: form.diasDepois,
          estoque: form.estoque,
        });
      } else {
        await api.post('/api/products', form);
      }
      closeModal();
      await loadProducts(page, search, sortBy, sortDir);
    } catch (err) {
      const msg = err?.response?.data?.error || t('products.errorSave');
      setValidationErrors([msg]);
    } finally {
      setSaving(false);
    }
  }

  // ─── Remove produto alugável ──────────────────────────────────────────────
  async function handleDelete(id) {
    if (!window.confirm(t('products.confirmDelete'))) return;
    try {
      await api.delete(`/api/products/${id}`);
      await loadProducts(page, search, sortBy, sortDir);
    } catch {
      alert(t('products.errorDelete'));
    }
  }

  // ─── Helpers de idioma ────────────────────────────────────────────────────
  function getProductName(p) {
    return p.nuvemshopName || p.productId;
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box display="flex" flexDirection="column" gap="4">

      {/* Breadcrumb — Produtos é a tela inicial do app, sem nível acima */}
      <Box display="flex" alignItems="center" gap="1">
        <Text as="span" color="neutral-textLow">{t('products.title')}</Text>
      </Box>

      {/* Cabeçalho */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="3">
        <Title as="h2">{t('products.heading')}</Title>
        <Box display="flex" gap="2">
          <Button appearance="neutral" onClick={() => navigate('/alugueis')}>
            {t('products.navRentals')}
          </Button>
          <Button appearance="primary" onClick={openCreate}>
            {t('products.addProduct')}
          </Button>
        </Box>
      </Box>

      {/* Busca */}
      {!loading && (total > 0 || search) && (
        <Box style={{ maxWidth: 360 }}>
          <Input
            placeholder={t('products.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </Box>
      )}

      {/* Estado de erro global */}
      {error && (
        <Alert appearance="danger">
          <Text>{error}</Text>
        </Alert>
      )}

      {/* Estado de carregamento */}
      {loading ? (
        <Box display="flex" justifyContent="center" padding="8">
          <Spinner size="large" />
        </Box>
      ) : total === 0 && !search ? (
        <Box
          padding="8"
          display="flex"
          flexDirection="column"
          alignItems="center"
          gap="3"
          borderColor="neutral-surfaceHighlight"
          borderStyle="dashed"
          borderWidth="1"
          borderRadius="2"
        >
          <Text color="neutral-textLow">{t('products.empty')}</Text>
          <Button appearance="primary" onClick={openCreate}>
            {t('products.addProduct')}
          </Button>
        </Box>
      ) : products.length === 0 ? (
        <Box
          padding="8"
          display="flex"
          justifyContent="center"
          borderColor="neutral-surfaceHighlight"
          borderStyle="dashed"
          borderWidth="1"
          borderRadius="2"
        >
          <Text color="neutral-textLow">{t('products.searchEmpty')}</Text>
        </Box>
      ) : (
        /* Tabela */
        <Box style={{ overflowX: 'auto' }}>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Cell as="th">
                  <SortableHeader label={t('products.colProduct')} field="nuvemshopName" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </Table.Cell>
                <Table.Cell as="th">
                  <SortableHeader label={t('products.colQtyRented')} field="qtdeAlugada" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </Table.Cell>
                <Table.Cell as="th">
                  <SortableHeader label={t('products.colStatus')} field="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </Table.Cell>
                <Table.Cell as="th">
                  <SortableHeader label={t('products.colStock')} field="estoque" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </Table.Cell>
                <Table.Cell as="th">{t('products.colActions')}</Table.Cell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {products.map((p) => (
                <Table.Row key={p.id}>
                  {/* Produto */}
                  <Table.Cell>
                    <Box display="flex" gap="3" alignItems="center">
                      {p.nuvemshopImage ? (
                        <Thumbnail
                          src={p.nuvemshopImage}
                          alt={getProductName(p)}
                          width="48px"
                          aspectRatio="1/1"
                        />
                      ) : (
                        <Box
                          width="48px"
                          backgroundColor="neutral-surfaceHighlight"
                          borderRadius="2"
                          style={{ height: 48, flexShrink: 0 }}
                        />
                      )}
                      <Box display="flex" flexDirection="column" gap="1">
                        <Text fontWeight="bold" fontSize="base">
                          {getProductName(p)}
                        </Text>
                        <Text fontSize="caption" color="neutral-textLow">
                          {t('products.daysBefore', { count: p.diasAntes })}
                        </Text>
                        <Text fontSize="caption" color="neutral-textLow">
                          {t('products.daysAfter', { count: p.diasDepois })}
                        </Text>
                      </Box>
                    </Box>
                  </Table.Cell>

                  {/* Qtde. Alugada — soma de quantity dos aluguéis ativos (status 1 e 2) */}
                  <Table.Cell>
                    {p.qtdeAlugada > 0 ? (
                      <Text fontWeight="bold">{p.qtdeAlugada}</Text>
                    ) : (
                      <Text color="neutral-textDisabled">0</Text>
                    )}
                  </Table.Cell>

                  {/* Situação */}
                  <Table.Cell>
                    <Tag appearance={p.status === 1 ? 'success' : 'danger'}>
                      {p.status === 1 ? t('products.statusActive') : t('products.statusInactive')}
                    </Tag>
                  </Table.Cell>

                  {/* Estoque */}
                  <Table.Cell>
                    <Text>{p.estoque}</Text>
                  </Table.Cell>

                  {/* Ações */}
                  <Table.Cell>
                    <ActionsMenu
                      labelEdit={t('products.actionEdit')}
                      labelDelete={t('products.actionDelete')}
                      onEdit={() => openEdit(p)}
                      onDelete={() => handleDelete(p.id)}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Box>
      )}

      {!loading && pageCount > 1 && (
        <Box display="flex" justifyContent="center">
          <Pagination activePage={page} pageCount={pageCount} onPageChange={setPage} />
        </Box>
      )}

      {/* Modal Add/Edit */}
      <Modal open={modalOpen} onDismiss={closeModal}>
        <Modal.Header
          title={editing ? t('products.modalEditTitle') : t('products.modalAddTitle')}
        />
        <Modal.Body padding="base">
          <Box display="flex" flexDirection="column" gap="4">

            {validationErrors.length > 0 && (
              <Alert appearance="danger" title={t('common.error')}>
                <Box as="ul" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {validationErrors.map((msg, i) => (
                    <li key={i}>
                      <Text fontSize="caption">{msg}</Text>
                    </li>
                  ))}
                </Box>
              </Alert>
            )}

            {/* Seleção do produto (somente na criação) */}
            {!editing && (
              <Box display="flex" flexDirection="column" gap="1">
                <Text as="label" htmlFor="productId" fontWeight="bold" fontSize="caption">
                  {t('products.fieldProduct')}
                </Text>
                {nsLoading ? (
                  <Box display="flex" alignItems="center" gap="2">
                    <Spinner size="small" />
                    <Text fontSize="caption" color="neutral-textLow">
                      {t('products.loadingProducts')}
                    </Text>
                  </Box>
                ) : (
                  <Select
                    id="productId"
                    value={form.productId}
                    appearance={invalidFields.has('productId') ? 'danger' : undefined}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, productId: e.target.value }));
                      clearInvalid('productId');
                    }}
                  >
                    <option value="">{t('products.selectProduct')}</option>
                    {nsProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                )}
                {nsProducts.length === 0 && !nsLoading && (
                  <Text fontSize="caption" color="neutral-textLow">
                    {t('products.noProductsAvailable')}
                  </Text>
                )}
              </Box>
            )}

            {/* Estoque */}
            <Box display="flex" flexDirection="column" gap="1">
              <Text as="label" htmlFor="estoque" fontWeight="bold" fontSize="caption">
                {t('products.fieldStock')}
              </Text>
              <Input
                id="estoque"
                type="number"
                min="1"
                step="1"
                appearance={invalidFields.has('estoque') ? 'danger' : undefined}
                value={String(form.estoque)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, estoque: Number(e.target.value) }));
                  clearInvalid('estoque');
                }}
              />
            </Box>

            {/* Dias de antecedência */}
            <Box display="flex" flexDirection="column" gap="1">
              <Text as="label" htmlFor="diasAntes" fontWeight="bold" fontSize="caption">
                {t('products.fieldDaysBefore')}
              </Text>
              <Input
                id="diasAntes"
                type="number"
                min="0"
                step="1"
                appearance={invalidFields.has('diasAntes') ? 'danger' : undefined}
                value={String(form.diasAntes)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, diasAntes: Number(e.target.value) }));
                  clearInvalid('diasAntes');
                }}
              />
              <Text fontSize="caption" color="neutral-textLow">
                {t('products.fieldDaysBeforeHint')}
              </Text>
            </Box>

            {/* Dias de bloqueio após */}
            <Box display="flex" flexDirection="column" gap="1">
              <Text as="label" htmlFor="diasDepois" fontWeight="bold" fontSize="caption">
                {t('products.fieldDaysAfter')}
              </Text>
              <Input
                id="diasDepois"
                type="number"
                min="0"
                step="1"
                appearance={invalidFields.has('diasDepois') ? 'danger' : undefined}
                value={String(form.diasDepois)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, diasDepois: Number(e.target.value) }));
                  clearInvalid('diasDepois');
                }}
              />
              <Text fontSize="caption" color="neutral-textLow">
                {t('products.fieldDaysAfterHint')}
              </Text>
            </Box>

            {/* Status */}
            <Box display="flex" alignItems="center" gap="3">
              <Toggle
                name="status"
                id="status"
                checked={form.status === 1}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 1 : 0 }))}
                label={form.status === 1 ? t('products.statusActive') : t('products.statusInactive')}
              />
            </Box>

          </Box>
        </Modal.Body>
        <Modal.Footer>
          <Box display="flex" gap="2" justifyContent="flex-end">
            <Button appearance="neutral" onClick={closeModal} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="small" /> : t('common.save')}
            </Button>
          </Box>
        </Modal.Footer>
      </Modal>

    </Box>
  );
}
