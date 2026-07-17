import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Box,
  Text,
  Title,
  Button,
  Tag,
  Select,
  Input,
  Spinner,
  Alert,
  Card,
} from '@nimbus-ds/components';
import api from '../services/api.js';
import { RENTAL_STATUS_META as COLUMNS } from '../lib/rentalStatus.js';
import { toInputDate, formatDisplayDate, formatDisplayDateTime } from '../lib/dateDisplay.js';

const itemId = (rentalId) => `rental-${rentalId}`;
const columnId = (status) => `col-${status}`;
const parseItemId = (id) => Number(String(id).replace('rental-', ''));
const parseColumnId = (id) => Number(String(id).replace('col-', ''));

function todayRangeDefault() {
  const dataFinal = new Date();
  const dataInicial = new Date(dataFinal.getTime() - 7 * 86400000);
  return { dataInicial: toInputDate(dataInicial), dataFinal: toInputDate(dataFinal) };
}

// ─── Conteúdo visual de um card de aluguel (Nimbus puro) ─────────────────────
function RentalCardContent({ rental, t }) {
  return (
    <Card padding="base">
      <Box display="flex" flexDirection="column" gap="1">
        <Text fontWeight="bold" fontSize="base">
          {t('rentals.cardOrder', { number: rental.orderNumber })}
        </Text>
        <Text fontSize="caption" color="neutral-textLow">
          {t('rentals.cardCreatedAt')}: {formatDisplayDateTime(rental.orderCreatedAt)}
        </Text>
        <Text fontSize="caption" color="neutral-textLow">
          {t('rentals.cardStart')}: {formatDisplayDate(rental.reservationStart)}
        </Text>
        <Text fontSize="caption" color="neutral-textLow">
          {t('rentals.cardEnd')}: {formatDisplayDate(rental.reservationEnd)}
        </Text>
        <Text fontSize="caption" fontWeight="bold">
          {t('rentals.cardProduct')}: {rental.productName}
        </Text>
        {rental.customerName && (
          <Text fontSize="caption" color="neutral-textLow">
            {t('rentals.cardCustomer')}: {rental.customerName}
          </Text>
        )}
      </Box>
    </Card>
  );
}

// ─── Card arrastável (@dnd-kit/sortable) ──────────────────────────────────────
function SortableRentalCard({ rental, status, t }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemId(rental.id),
    data: { status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <Box ref={setNodeRef} style={style} {...attributes} {...listeners} marginBottom="2">
      <RentalCardContent rental={rental} t={t} />
    </Box>
  );
}

// ─── Coluna (container arrastável — @dnd-kit/core useDroppable) ──────────────
function KanbanColumn({ col, rentals, t }) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(col.status) });
  const ids = useMemo(() => rentals.map((r) => itemId(r.id)), [rentals]);

  return (
    <Box style={{ minWidth: 260, flex: '1 0 260px' }}>
      <Box display="flex" alignItems="center" gap="2" marginBottom="3">
        <Tag appearance={col.appearance}>{t(col.labelKey)}</Tag>
        <Text fontSize="caption" color="neutral-textLow">
          {rentals.length}
        </Text>
      </Box>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <Box
          ref={setNodeRef}
          padding="2"
          borderRadius="2"
          backgroundColor={isOver ? 'neutral-surfaceHighlight' : 'neutral-surface'}
          style={{ minHeight: 120 }}
        >
          {rentals.length === 0 && (
            <Text fontSize="caption" color="neutral-textDisabled">
              {t('rentals.emptyColumn')}
            </Text>
          )}
          {rentals.map((rental) => (
            <SortableRentalCard key={rental.id} rental={rental} status={col.status} t={t} />
          ))}
        </Box>
      </SortableContext>
    </Box>
  );
}

export default function RentalsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [rentals, setRentals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null); // { appearance, message }
  const feedbackTimer = useRef(null);
  const [activeRental, setActiveRental] = useState(null);

  const defaults = useMemo(() => todayRangeDefault(), []);
  const [criterio, setCriterio] = useState(1);
  const [dataInicial, setDataInicial] = useState(defaults.dataInicial);
  const [dataFinal, setDataFinal] = useState(defaults.dataFinal);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const showFeedback = useCallback((appearance, message) => {
    setFeedback({ appearance, message });
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000);
  }, []);

  const loadRentals = useCallback(async (filters) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/rentals', { params: filters });
      setRentals(data.rentals || []);
    } catch {
      setError(t('rentals.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRentals({ criterio, dataInicial, dataFinal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilter() {
    loadRentals({ criterio, dataInicial, dataFinal });
  }

  const columns = useMemo(() => {
    const map = { 0: [], 1: [], 2: [], 3: [] };
    for (const r of rentals) {
      (map[r.status] || map[1]).push(r);
    }
    return map;
  }, [rentals]);

  function handleDragStart(event) {
    const rentalId = parseItemId(event.active.id);
    setActiveRental(rentals.find((r) => r.id === rentalId) || null);
  }

  async function handleDragEnd(event) {
    const { active, over } = event;
    setActiveRental(null);
    if (!over) return;

    const rentalId = parseItemId(active.id);
    const originalStatus = active.data.current?.status;

    const overIdStr = String(over.id);
    const newStatus = overIdStr.startsWith('col-')
      ? parseColumnId(overIdStr)
      : over.data.current?.status;

    if (newStatus == null || newStatus === originalStatus) return;

    const previous = rentals;
    setRentals((prev) => prev.map((r) => (r.id === rentalId ? { ...r, status: newStatus } : r)));

    try {
      await api.patch(`/api/rentals/${rentalId}/status`, { status: newStatus });
      showFeedback('success', t('rentals.statusUpdated'));
    } catch {
      setRentals(previous);
      showFeedback('danger', t('rentals.errorStatusUpdate'));
    }
  }

  return (
    <Box display="flex" flexDirection="column" gap="4">

      {/* Breadcrumb */}
      <Box display="flex" alignItems="center" gap="1">
        <Text as="span" color="primary-interactive" cursor="pointer" onClick={() => navigate('/produtos')}>
          {t('products.title')}
        </Text>
        <Text as="span" color="neutral-textDisabled"> / </Text>
        <Text as="span" color="primary-interactive" cursor="pointer" onClick={() => navigate('/alugueis')}>
          {t('rentals.title')}
        </Text>
        <Text as="span" color="neutral-textDisabled"> / </Text>
        <Text as="span" color="neutral-textLow">{t('rentals.fluxoBtn')}</Text>
      </Box>

      {/* Cabeçalho */}
      <Title as="h2">{t('rentals.heading')}</Title>

      {/* Filtros */}
      <Box display="flex" gap="3" flexWrap="wrap" alignItems="flex-end">
        <Box display="flex" flexDirection="column" gap="1">
          <Text as="label" htmlFor="criterio" fontSize="caption" fontWeight="bold">
            {t('rentals.filterCriterio')}
          </Text>
          <Select id="criterio" value={String(criterio)} onChange={(e) => setCriterio(Number(e.target.value))}>
            <option value="1">{t('rentals.criterioOrderCreated')}</option>
            <option value="2">{t('rentals.criterioReservationStart')}</option>
            <option value="3">{t('rentals.criterioReservationEnd')}</option>
          </Select>
        </Box>
        <Box display="flex" flexDirection="column" gap="1">
          <Text as="label" htmlFor="dataInicial" fontSize="caption" fontWeight="bold">
            {t('rentals.filterFrom')}
          </Text>
          <Input id="dataInicial" type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
        </Box>
        <Box display="flex" flexDirection="column" gap="1">
          <Text as="label" htmlFor="dataFinal" fontSize="caption" fontWeight="bold">
            {t('rentals.filterTo')}
          </Text>
          <Input id="dataFinal" type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
        </Box>
        <Button appearance="primary" onClick={handleFilter}>
          {t('rentals.filterApply')}
        </Button>
      </Box>

      {/* Feedback */}
      {feedback && (
        <Alert appearance={feedback.appearance}>
          <Text>{feedback.message}</Text>
        </Alert>
      )}
      {error && (
        <Alert appearance="danger">
          <Text>{error}</Text>
        </Alert>
      )}

      {/* Board */}
      {loading ? (
        <Box display="flex" justifyContent="center" padding="8">
          <Spinner size="large" />
        </Box>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <Box display="flex" gap="4" style={{ overflowX: 'auto' }}>
            {COLUMNS.map((col) => (
              <KanbanColumn key={col.status} col={col} rentals={columns[col.status]} t={t} />
            ))}
          </Box>
          <DragOverlay>
            {activeRental ? <RentalCardContent rental={activeRental} t={t} /> : null}
          </DragOverlay>
        </DndContext>
      )}

    </Box>
  );
}
